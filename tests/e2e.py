# 실제 브라우저(모바일 화면)로 프로젝트 등록 → 일지 저장 → 집계 → 견적 흐름을 확인
# 실행: python3 -m http.server 8765 &  →  python3 tests/e2e.py
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/'
errors = []

with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, accept_downloads=True)
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL)

    def chip(label_text, value):
        page.locator('.fld', has=page.locator('label', has_text=label_text)).first.locator('.chip', has_text=value).first.click()

    # 1. 신규 사용자가 프로젝트 생성 (설비 2대 × 모듈 4개 — 3개 고정 아님)
    page.click('text=프로젝트 만들기')
    page.fill('[data-bind="pform.name"]', '테스트 프로젝트 A')
    page.fill('[data-bind="pform.equipCount"]', '2')
    page.fill('[data-bind="pform.moduleCount"]', '4')
    page.click('button[data-act="proj-create"]')
    assert page.locator('text=설비 2대 · 모듈 8개').count() == 1, '설비/모듈 생성'

    # 2. 일지: 부품명만 입력, 나머지 선택 — 24개 × 0.8분 + 준비 12 + 검사 6
    page.click('#tabs [data-tab="log"]')
    page.fill('input.part', '센서 브래킷')
    chip('볼트', 'M8'); chip('볼트 길이', '25'); chip('너트', '없음')
    chip('체결 수량', '24'); chip('조립시간', '0.8분'); chip('작업 인원', '2명')
    chip('준비시간', '12'); chip('검사시간', '6'); chip('대기시간', '10분')
    assert page.inner_text('#live-net') == '37.2인분', page.inner_text('#live-net')
    assert page.inner_text('#live-mh') == '0.62'
    assert '반복 19.2인분' in page.inner_text('#live .formula')
    page.screenshot(path='/tmp/log_form.png', full_page=True)
    page.click('button[data-act="save-rec"]')
    assert page.locator('.rec').count() == 1

    # 3. 두 번째 기록: 다른 설비·모듈, 같은 부품명 → 지난 선택값 자동 불러오기
    chip('설비', '설비 2'); chip('모듈', '모듈 3')
    page.fill('input.part', '센서 브래킷'); page.locator('input.part').blur()
    assert page.locator('text=선택값을 불러왔습니다').count() == 1, '자동 불러오기'
    assert page.inner_text('#live-net') == '37.2인분'
    chip('체결 수량', '10')
    page.click('button[data-act="save-rec"]')
    assert page.locator('.rec').count() == 2

    # 4. 저장 후 재접속해도 유지
    page.reload()
    assert page.locator('.rec').count() == 2, '재접속 후 유지'

    # 5. 집계: 프로젝트 = 설비 합 = 모듈 합  (37.2 + 26 = 63.2인분)
    page.click('#tabs [data-tab="summary"]')
    rows = page.locator('table').first.locator('tr')
    val = lambda cls: [float(r.locator('td').nth(2).inner_text()) for r in rows.all() if cls in (r.get_attribute('class') or '')]
    assert val('l0') == [63.2], val('l0')
    assert round(sum(val('l1')), 2) == 63.2 and round(sum(val('l2')), 2) == 63.2 and round(sum(val('l3')), 2) == 63.2
    page.screenshot(path='/tmp/summary.png', full_page=True)

    # 6. 견적: 실측값 자동 채움 → 저장 → 엑셀 다운로드
    page.click('#tabs [data-tab="estimate"]')
    assert page.input_value('[data-bind="est.units"]') == '2'
    assert page.input_value('[data-bind="est.mhPerUnit"]') == '0.53', page.input_value('[data-bind="est.mhPerUnit"]')
    page.fill('[data-bind="est.mhPerUnit"]', '100')
    page.fill('[data-bind="est.material"]', '500000')
    assert '권장 견적가격' in page.inner_text('#estres')
    page.fill('[data-bind="est.scope"]', '조립·설치·레벨링')
    page.click('button[data-act="est-save"]')
    with page.expect_download() as dl:
        page.click('button[data-act="est-csv"]')
    text = open(dl.value.path(), encoding='utf-8-sig').read()
    assert '견적가격(부가세 별도)' in text and '조립·설치·레벨링' in text
    page.screenshot(path='/tmp/estimate.png', full_page=True)

    # 7. 견적서 인쇄(PDF) 화면 구성
    page.evaluate('window.print = () => {}')
    page.click('button[data-act="est-print"]')
    assert '견 적 서' in page.inner_text('#print', timeout=2000) or page.locator('#print h1').count() == 1

    # 8. 일지 삭제는 두 번 눌러야 실행
    page.click('#tabs [data-tab="log"]')
    page.locator('button[data-act="del-rec"]').first.click()
    assert page.locator('.rec').count() == 2
    page.locator('button[data-act="del-rec"]').first.click()
    assert page.locator('.rec').count() == 1

    # 9. 선택 항목 추가
    page.locator('.chip.add[data-k="perTimes"]').click()
    page.fill('#addinp', '0.6'); page.click('button[data-act="addok"]')
    assert page.locator('.chip.on', has_text='0.6분').count() == 1

    # 10. 가로 넘침 없음(모바일)
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '가로 스크롤 발생'
    b.close()

assert not errors, errors
print('브라우저 흐름 테스트 전부 통과')
