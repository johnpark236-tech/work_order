import { calcRecord, sumRecords, buildStandards, standardKey, findAnomalies, calcEstimate, round2 } from './calc.js';

/* ───────── 저장소 ───────── */
const KEY = 'work_order_v1';
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const DEFAULT_OPTIONS = {
  processes: ['마킹', '안착', '레벨링', '조립', '체결', '정렬', '배선', '배관', '검사', '기타'],
  assemblies: ['공통', '프레임', '브래킷', '커버', '베이스'],
  bolts: ['없음', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M16', 'M20'],
  lengths: [8, 10, 12, 16, 20, 25, 30, 35, 40, 50, 60, 80],
  nuts: ['없음', '육각 너트', '플랜지 너트', '나일론 너트', 'T 너트', '캡 너트'],
  washers: ['없음', '평와셔', '스프링와셔', '평+스프링'],
  tools: ['육각렌치', '전동 드라이버', '임팩트', '토크렌치', '스패너', '기타 수공구'],
  qtys: [1, 2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40],
  perTimes: [0.2, 0.3, 0.5, 0.8, 1, 1.5, 2, 3, 5, 10],
  preps: [0, 5, 10, 12, 15, 20, 30],
  inspects: [0, 3, 5, 6, 10, 15],
  waits: [0, 5, 10, 15, 20, 30, 60],
  reworks: [0, 5, 10, 15, 20, 30, 60],
  equipTypes: ['이송 설비', '보관 설비', '조립 설비', '검사 설비', '기타'],
};
const OPT_LABEL = {
  processes: '공정', assemblies: '조립체', bolts: '볼트 규격', lengths: '볼트 길이(mm)', nuts: '너트', washers: '와셔',
  tools: '체결 공구', qtys: '수량 빠른선택', perTimes: '개당 작업시간(분)', preps: '준비시간(인분)', inspects: '검사시간(인분)',
  waits: '대기시간(분)', reworks: '재작업시간(분)', equipTypes: '설비 유형',
};
const NUM_OPT = new Set(['lengths', 'qtys', 'perTimes', 'preps', 'inspects', 'waits', 'reworks']);
const NUM_F = new Set(['qty', 'per', 'workers', 'prep', 'inspect', 'extra', 'wait', 'rework', 'length', 'units', 'mhPerUnit', 'daily', 'hours',
  'material', 'equipCost', 'indirect', 'waitRisk', 'reworkRisk', 'profit', 'equipCount', 'moduleCount', 'contract', 'targetCost']);
const WORKERS = [1, 2, 3, 4, 5, 6];
const RATES = [0, 5, 10, 15, 20, 25, 30];
const DAILIES = [150000, 180000, 200000, 220000, 250000, 300000];

const newDraft = (keep = {}) => ({
  date: today(), projectId: null, equipId: null, moduleId: null, assembly: '공통', process: '조립', part: '',
  bolt: '없음', length: null, nut: '없음', washer: '없음', tool: null, qty: 1, per: 1, workers: 1,
  prep: 0, inspect: 0, extra: 0, wait: 0, rework: 0, access: '보통', issue: '없음', done: '완료', memo: '', editId: null, ...keep,
});
const newEst = () => ({
  projectId: null, units: 1, mhPerUnit: 0, daily: 200000, hours: 8, material: 0, equipCost: 0, indirect: 10,
  waitRisk: 0, reworkRisk: 0, profit: 15, client: '', scope: '', excluded: '', payment: '', inspection: '', warranty: '',
});
const newPform = () => ({ name: '', code: '', type: '기타', equipCount: 1, moduleCount: 1, status: '진행', start: today(), due: '', contract: 0, targetCost: 0 });

function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* 저장소 사용 불가 */ }
  s ||= {};
  s.settings ||= {};
  s.settings.worker ??= '';
  s.settings.company ??= '';
  s.settings.eff ||= { 1: 1, 2: 0.9, 3: 0.85, 4: 0.8, 5: 0.75, 6: 0.7 };
  s.settings.options = { ...structuredClone(DEFAULT_OPTIONS), ...(s.settings.options || {}) };
  s.projects ||= []; s.records ||= []; s.estimates ||= [];
  s.draft = { ...newDraft(), ...(s.draft || {}) };
  s.est = { ...newEst(), ...(s.est || {}) };
  return s;
}
let state = load();
let saveOk = true;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); saveOk = true; }
  catch { if (saveOk) toast('이 브라우저에서는 저장이 되지 않습니다'); saveOk = false; }
}

const ui = { tab: 'log', adding: null, confirm: null, open: null, pform: newPform(), sumProj: null, autofill: null, moreOpen: false };
const roots = () => ({ draft: state.draft, pform: ui.pform, est: state.est, settings: state.settings, ui });

/* ───────── 도우미 ───────── */
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
const f1 = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('ko-KR');
const O = (k) => state.settings.options[k];
const proj = (id) => state.projects.find((p) => p.id === id);
const equip = (p, id) => p?.equipment.find((e) => e.id === id);
const modu = (e, id) => e?.modules.find((m) => m.id === id);
const pathName = (r) => {
  const p = proj(r.projectId), e = equip(p, r.equipId), m = modu(e, r.moduleId);
  return [p?.name || '(삭제된 프로젝트)', e?.name, m?.name].filter(Boolean).join(' › ');
};
const spec = (r) => r.bolt && r.bolt !== '없음'
  ? `${r.bolt}${r.length ? '×' + r.length : ''}${r.nut !== '없음' ? ' · ' + r.nut : ''}${r.washer !== '없음' ? ' · ' + r.washer : ''}` : '';
const stds = () => buildStandards(state.records);
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }
function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: type + ';charset=utf-8' }));
  a.download = name; document.body.append(a); a.click(); a.remove();
}
const csv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');

function chips(f, list, val, o = {}) {
  const root = o.root || 'draft';
  const items = [...list];
  if (val != null && val !== '' && !items.some((x) => String(x) === String(val))) items.push(val);
  let h = '<div class="chips">' + items.map((x) =>
    `<button type="button" class="chip${String(x) === String(val) ? ' on' : ''}" data-act="set" data-root="${root}" data-f="${f}" data-v="${esc(x)}">${esc(o.fmt ? o.fmt(x) : x)}${o.unit && x !== '없음' ? o.unit : ''}</button>`).join('');
  if (o.optKey) h += `<button type="button" class="chip add" data-act="addopt" data-k="${o.optKey}" data-f="${f}" data-root="${root}" aria-label="항목 추가">＋</button>`;
  h += '</div>';
  if (o.optKey && ui.adding === o.optKey + ':' + f) {
    h += `<div class="addbox"><input id="addinp" type="${NUM_OPT.has(o.optKey) ? 'number' : 'text'}" step="any" inputmode="${NUM_OPT.has(o.optKey) ? 'decimal' : 'text'}" placeholder="새 항목 입력">
      <button type="button" class="btn navy" data-act="addok" data-k="${o.optKey}" data-f="${f}" data-root="${root}">추가</button></div>`;
  }
  return h;
}
const fld = (label, body, note = '') => `<div class="fld"><label>${label}${note ? `<em>${note}</em>` : ''}</label>${body}</div>`;
const stepper = (f, val, root = 'draft', step = 1) => `<div class="step">
  <button type="button" data-act="step" data-root="${root}" data-f="${f}" data-d="${-step}">−</button>
  <input type="number" inputmode="decimal" value="${val}" data-bind="${root}.${f}">
  <button type="button" data-act="step" data-root="${root}" data-f="${f}" data-d="${step}">＋</button></div>`;
const money = (f, val, root) => `<input type="number" inputmode="numeric" step="10000" value="${val || ''}" placeholder="0" data-bind="${root}.${f}">`;
const dangerLabel = (key, label) => (ui.confirm === key ? '한 번 더 눌러 삭제' : label);

/* ───────── 일지 ───────── */
function fixContext() {
  const d = state.draft;
  let p = proj(d.projectId);
  if (!p) { p = state.projects[0]; d.projectId = p?.id ?? null; }
  let e = equip(p, d.equipId);
  if (!e) { e = p?.equipment[0]; d.equipId = e?.id ?? null; }
  if (!modu(e, d.moduleId)) d.moduleId = e?.modules[0]?.id ?? null;
}

function liveHtml() {
  const d = state.draft, c = calcRecord(d, state.settings.eff);
  return `<div class="formula">${f1(d.qty)}개 × ${f1(d.per)}분 = 반복 ${f1(c.repeat)}인분 ＋ 준비 ${f1(d.prep)} ＋ 검사 ${f1(d.inspect)}</div>
  <div class="nums">
    <div>순공수<b class="hot" id="live-net">${f1(c.net)}인분</b></div>
    <div>공수(MH)<b id="live-mh">${f1(c.mh)}</b></div>
    <div>예상 소요(${d.workers}명)<b>${f1(c.elapsed)}분</b></div>
  </div>`;
}

function recHtml(r) {
  const c = calcRecord(r, state.settings.eff);
  return `<div class="rec">
    <div class="row between" style="flex-wrap:nowrap;align-items:flex-start">
      <div><div class="t">${esc(r.part)} ${spec(r) ? `<span class="tag gray">${esc(spec(r))}</span>` : ''}${r.done === '진행중' ? '<span class="tag">진행중</span>' : ''}${r.issue === '있음' ? '<span class="tag bad">문제</span>' : ''}</div>
        <div class="s">${esc(pathName(r))} · ${esc(r.assembly)} · ${esc(r.process)}</div>
        <div class="s">${f1(r.qty)}개 × ${f1(r.per)}분 · ${r.workers}명${r.prep ? ' · 준비 ' + r.prep : ''}${r.inspect ? ' · 검사 ' + r.inspect : ''}${r.wait ? ' · 대기 ' + r.wait + '분' : ''}${r.rework ? ' · 재작업 ' + r.rework + '분' : ''}</div>
        ${r.memo ? `<div class="s">메모: ${esc(r.memo)}</div>` : ''}</div>
      <div class="n">${f1(c.net)}인분<div class="s">${f1(c.mh)} MH</div></div>
    </div>
    <div class="row" style="margin-top:7px">
      <button class="btn sm" data-act="edit-rec" data-id="${r.id}">수정</button>
      <button class="btn sm" data-act="dup-rec" data-id="${r.id}">같은 내용으로 새로</button>
      <button class="btn sm danger" data-act="del-rec" data-id="${r.id}">${dangerLabel('rec' + r.id, '삭제')}</button>
    </div></div>`;
}

function viewLog() {
  if (!state.projects.length) {
    return `<div class="card"><h2>처음 오셨네요</h2><p class="mute">일지를 쓰려면 먼저 프로젝트를 하나 만들어 주세요. 설비·모듈 수만 고르면 구조가 자동으로 만들어집니다.</p>
      <button class="btn pri block" data-act="tab" data-tab="projects">프로젝트 만들기</button>
      <button class="btn block" style="margin-top:8px" data-act="tab" data-tab="help">❓ 사용법 먼저 보기</button></div>`;
  }
  fixContext();
  const d = state.draft, p = proj(d.projectId), e = equip(p, d.equipId);
  const hasBolt = d.bolt !== '없음';
  const std = stds().find((s) => s.key === standardKey(d));
  const partNames = [...new Set(state.records.map((r) => r.part))].slice(-60);
  const dayRecs = state.records.filter((r) => r.date === d.date);
  const day = sumRecords(dayRecs, state.settings.eff);
  const prevDate = [...new Set(state.records.map((r) => r.date))].filter((x) => x < d.date).sort().pop();

  return `
  <div class="card">
    <div class="datebar">
      <button data-act="day" data-d="-1" aria-label="전날">◀</button>
      <input type="date" value="${d.date}" data-bind="draft.date" data-rerender="1">
      <button data-act="day" data-d="1" aria-label="다음날">▶</button>
      <button data-act="day" data-d="0" style="width:auto;flex:none;white-space:nowrap;padding:0 12px;font-weight:700">오늘</button>
    </div>
  </div>

  <div class="card">
    <h2>${d.editId ? '기록 수정' : '작업 기록'} <span class="mute" style="font-weight:500">— 부품명만 입력, 나머지는 선택</span></h2>
    ${fld('프로젝트', chips('projectId', state.projects.map((x) => x.id), d.projectId, { fmt: (id) => proj(id)?.name }))}
    ${fld('설비', chips('equipId', p.equipment.map((x) => x.id), d.equipId, { fmt: (id) => equip(p, id)?.name }))}
    ${fld('모듈', e ? chips('moduleId', e.modules.map((x) => x.id), d.moduleId, { fmt: (id) => modu(e, id)?.name }) : '<span class="mute">설비를 먼저 추가하세요</span>')}
    ${fld('조립체', chips('assembly', O('assemblies'), d.assembly, { optKey: 'assemblies' }))}
    ${fld('공정', chips('process', O('processes'), d.process, { optKey: 'processes' }))}

    ${fld('부품명', `<input class="part" type="text" list="partlist" value="${esc(d.part)}" placeholder="예: 센서 브래킷" data-bind="draft.part" data-part="1" autocomplete="off" enterkeyhint="done">
      <datalist id="partlist">${partNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`, '직접 입력')}
    ${ui.autofill ? `<div class="smart"><span>이전 <b>${esc(ui.autofill)}</b> 기록의 선택값을 불러왔습니다</span></div>` : ''}

    ${fld('볼트', chips('bolt', O('bolts'), d.bolt, { optKey: 'bolts' }))}
    ${hasBolt ? fld('볼트 길이', chips('length', O('lengths'), d.length, { optKey: 'lengths' }), 'mm') : ''}
    ${hasBolt ? fld('너트', chips('nut', O('nuts'), d.nut, { optKey: 'nuts' })) : ''}
    ${hasBolt ? fld('와셔', chips('washer', O('washers'), d.washer, { optKey: 'washers' })) : ''}
    ${hasBolt ? fld('체결 공구', chips('tool', O('tools'), d.tool, { optKey: 'tools' })) : ''}

    ${fld(hasBolt ? '체결 수량' : '수량', stepper('qty', d.qty) + '<div style="height:8px"></div>' + chips('qty', O('qtys'), d.qty), '개')}
    ${fld(hasBolt ? '볼트 1개당 조립시간' : '1개당 작업시간', chips('per', O('perTimes'), d.per, { optKey: 'perTimes', unit: '분' }))}
    ${std ? `<div class="smart"><span>실측 평균 <b>${std.avg}분</b> · ${std.n}건 · 신뢰도 ${std.confidence}</span>
      <button class="btn sm navy" data-act="set" data-f="per" data-v="${std.avg}">적용</button></div>` : ''}
    ${fld('작업 인원', chips('workers', WORKERS, d.workers, { unit: '명' }))}
    ${fld('준비시간', chips('prep', O('preps'), d.prep, { optKey: 'preps' }), '인분')}
    ${fld('검사시간', chips('inspect', O('inspects'), d.inspect, { optKey: 'inspects' }), '인분')}
    ${fld('대기시간', chips('wait', O('waits'), d.wait, { optKey: 'waits', unit: '분' }), '공수와 별도 집계')}
    ${fld('재작업시간', chips('rework', O('reworks'), d.rework, { optKey: 'reworks', unit: '분' }), '공수와 별도 집계')}
    ${fld('작업 접근성', chips('access', ['양호', '보통', '협소'], d.access))}
    ${fld('문제 발생', chips('issue', ['없음', '있음'], d.issue))}
    ${fld('완료 상태', chips('done', ['완료', '진행중'], d.done))}
    ${fld('메모', `<input type="text" value="${esc(d.memo)}" placeholder="필요할 때만" data-bind="draft.memo">`, '선택')}

    <div class="live" id="live">${liveHtml()}</div>
    <button class="btn pri block" data-act="save-rec">${d.editId ? '수정 내용 저장' : '일지에 저장'}</button>
    ${d.editId ? '<button class="btn block" style="margin-top:8px" data-act="cancel-edit">수정 취소</button>' : ''}
    <p class="hint">선택한 내용은 자동으로 임시저장되어, 화면을 닫아도 이어서 작성할 수 있습니다.</p>
  </div>

  <div class="card">
    <div class="row between"><h2 style="margin:0">${d.date} 일지 <span class="mute">${dayRecs.length}건</span></h2>
      <div class="n" style="font-weight:800">${f1(day.mh)} MH</div></div>
    ${dayRecs.length ? `<div class="kpis" style="margin:10px 0">
        <div class="kpi"><span>순공수</span><b>${f1(day.net)}인분</b></div>
        <div class="kpi"><span>대기·재작업 손실</span><b>${f1(day.waitPM + day.reworkPM)}인분</b></div></div>
      ${dayRecs.map(recHtml).join('')}
      <div class="row" style="margin-top:10px">
        <button class="btn sm" data-act="text-day">일지 텍스트 복사</button>
        <button class="btn sm" data-act="csv-day">엑셀(CSV) 받기</button></div>`
    : `<p class="mute">이 날짜에 저장된 기록이 없습니다.</p>
       ${prevDate ? `<button class="btn" data-act="copy-prev" data-date="${prevDate}">${prevDate} 일지 그대로 가져오기</button>` : ''}`}
  </div>`;
}

function dayText(date) {
  const recs = state.records.filter((r) => r.date === date), s = sumRecords(recs);
  return [`[작업일지] ${date}${state.settings.worker ? ' · ' + state.settings.worker : ''}`,
    ...recs.map((r, i) => {
      const c = calcRecord(r);
      return `${i + 1}. ${pathName(r)} · ${r.process} · ${r.part}${spec(r) ? ' (' + spec(r) + ')' : ''} ${r.qty}개×${r.per}분, ${r.workers}명 → ${c.net}인분(${c.mh}MH)${r.wait ? ', 대기 ' + r.wait + '분' : ''}${r.rework ? ', 재작업 ' + r.rework + '분' : ''}`;
    }),
    `합계: ${s.net}인분 = ${s.mh}MH / 대기·재작업 ${round2(s.waitPM + s.reworkPM)}인분`].join('\n');
}
function recordRows(recs) {
  return [['날짜', '작업자', '프로젝트', '설비', '모듈', '조립체', '공정', '부품명', '볼트', '길이(mm)', '너트', '와셔', '공구', '수량', '개당(분)', '인원', '준비(인분)', '검사(인분)', '반복(인분)', '순공수(인분)', '공수(MH)', '대기(분)', '재작업(분)', '접근성', '문제', '상태', '메모'],
    ...recs.map((r) => {
      const p = proj(r.projectId), e = equip(p, r.equipId), m = modu(e, r.moduleId), c = calcRecord(r);
      return [r.date, r.worker || '', p?.name, e?.name, m?.name, r.assembly, r.process, r.part, r.bolt, r.length ?? '', r.nut, r.washer, r.tool ?? '', r.qty, r.per, r.workers, r.prep, r.inspect, c.repeat, c.net, c.mh, r.wait, r.rework, r.access, r.issue, r.done, r.memo];
    })];
}

/* ───────── 프로젝트 ───────── */
function viewProjects() {
  const f = ui.pform;
  return `
  <div class="card"><h2>새 프로젝트</h2>
    ${fld('프로젝트명', `<input type="text" value="${esc(f.name)}" placeholder="내 작업공간에서만 보이는 이름" data-bind="pform.name">`)}
    ${fld('관리번호', `<input type="text" value="${esc(f.code)}" placeholder="선택" data-bind="pform.code">`, '선택')}
    ${fld('설비 유형', chips('type', O('equipTypes'), f.type, { root: 'pform', optKey: 'equipTypes' }))}
    <div class="grid2">${fld('설비 수량', stepper('equipCount', f.equipCount, 'pform'), '대')}${fld('설비당 모듈 수', stepper('moduleCount', f.moduleCount, 'pform'), '개')}</div>
    <div class="grid2">${fld('시작일', `<input type="date" value="${f.start}" data-bind="pform.start">`)}${fld('목표 완료일', `<input type="date" value="${f.due}" data-bind="pform.due">`)}</div>
    <div class="grid2">${fld('계약 예정금액', money('contract', f.contract, 'pform'), '원')}${fld('목표 원가', money('targetCost', f.targetCost, 'pform'), '원')}</div>
    <button class="btn pri block" style="margin-top:14px" data-act="proj-create">프로젝트 만들기</button>
  </div>
  ${state.projects.map((p) => {
    const s = sumRecords(state.records.filter((r) => r.projectId === p.id));
    const open = ui.open === p.id;
    return `<div class="card">
      <div class="row between"><div><b style="font-size:17px">${esc(p.name)}</b> <span class="tag ${p.status === '완료' ? 'ok' : ''}">${esc(p.status)}</span>
        <div class="mute">${esc(p.code || '')} ${esc(p.type)} · 설비 ${p.equipment.length}대 · 모듈 ${p.equipment.reduce((a, e) => a + e.modules.length, 0)}개 · 실적 ${f1(s.mh)} MH</div></div>
        <button class="btn sm" data-act="proj-open" data-id="${p.id}">${open ? '접기' : '구성 편집'}</button></div>
      ${open ? `<div class="tree">
        ${fld('프로젝트명', `<input type="text" value="${esc(p.name)}" data-pe="${p.id}" data-k="name">`)}
        ${fld('상태', `<div class="chips">${['준비', '진행', '완료', '보류'].map((x) => `<button class="chip${p.status === x ? ' on' : ''}" data-act="proj-status" data-id="${p.id}" data-v="${x}">${x}</button>`).join('')}</div>`)}
        <div class="grid2">${fld('계약 예정금액', `<input type="number" value="${p.contract || ''}" data-pe="${p.id}" data-k="contract">`, '원')}${fld('목표 원가', `<input type="number" value="${p.targetCost || ''}" data-pe="${p.id}" data-k="targetCost">`, '원')}</div>
        ${p.equipment.map((e) => `<div class="eq">
          <div class="row" style="flex-wrap:nowrap"><input type="text" value="${esc(e.name)}" data-ee="${p.id}|${e.id}">
            <button class="btn sm danger" data-act="eq-del" data-p="${p.id}" data-e="${e.id}">${dangerLabel('eq' + e.id, '삭제')}</button></div>
          ${e.modules.map((m) => `<div class="row" style="flex-wrap:nowrap;margin-top:6px;padding-left:14px"><input type="text" value="${esc(m.name)}" data-me="${p.id}|${e.id}|${m.id}">
            <button class="btn sm danger" data-act="mod-del" data-p="${p.id}" data-e="${e.id}" data-m="${m.id}">${dangerLabel('mod' + m.id, '삭제')}</button></div>`).join('')}
          <button class="btn sm" style="margin:8px 0 0 14px" data-act="mod-add" data-p="${p.id}" data-e="${e.id}">＋ 모듈 추가</button></div>`).join('')}
        <div class="row" style="margin-top:10px">
          <button class="btn sm navy" data-act="eq-add" data-p="${p.id}">＋ 설비 추가</button>
          <button class="btn sm" data-act="proj-dup" data-id="${p.id}">구성 복제(템플릿)</button>
          <button class="btn sm danger" data-act="proj-del" data-id="${p.id}">${dangerLabel('proj' + p.id, '프로젝트 삭제')}</button></div>
      </div>` : ''}
    </div>`;
  }).join('')}`;
}
const mkModules = (n) => Array.from({ length: n }, (_, i) => ({ id: uid(), name: `모듈 ${i + 1}` }));

/* ───────── 집계 ───────── */
function viewSummary() {
  if (!state.projects.length) return '<div class="card"><p class="mute">프로젝트를 먼저 만들어 주세요.</p></div>';
  if (!proj(ui.sumProj)) ui.sumProj = state.draft.projectId || state.projects[0].id;
  const p = proj(ui.sumProj), recs = state.records.filter((r) => r.projectId === p.id);
  const eff = state.settings.eff, all = sumRecords(recs, eff);
  const row = (cls, name, s) => `<tr class="${cls}"><td>${esc(name)}</td><td>${s.count}</td><td>${f1(s.net)}</td><td>${f1(s.mh)}</td><td>${f1(s.lossMH)}</td></tr>`;
  let rows = row('l0', p.name, all);
  for (const e of p.equipment) {
    const er = recs.filter((r) => r.equipId === e.id);
    rows += row('l1', e.name, sumRecords(er));
    for (const m of e.modules) {
      const mr = er.filter((r) => r.moduleId === m.id);
      rows += row('l2', m.name, sumRecords(mr));
      for (const a of [...new Set(mr.map((r) => r.assembly))]) rows += row('l3', a, sumRecords(mr.filter((r) => r.assembly === a)));
    }
  }
  const byProc = [...new Set(recs.map((r) => r.process))].map((k) => [k, sumRecords(recs.filter((r) => r.process === k))]);
  const byDate = [...new Set(recs.map((r) => r.date))].sort().reverse().slice(0, 31).map((k) => [k, sumRecords(recs.filter((r) => r.date === k))]);
  const st = stds(), an = findAnomalies(recs, st);
  const done = p.equipment.reduce((a, e) => a + e.modules.length, 0);
  const touched = new Set(recs.map((r) => r.moduleId)).size;
  return `
  <div class="card">${fld('프로젝트', chips('sumProj', state.projects.map((x) => x.id), ui.sumProj, { root: 'ui', fmt: (id) => proj(id)?.name }))}
    <div class="kpis" style="margin-top:12px">
      <div class="kpi big"><span>프로젝트 누적 순공수</span><b>${f1(all.mh)} MH</b></div>
      <div class="kpi"><span>순공수</span><b>${f1(all.net)}인분</b></div>
      <div class="kpi"><span>대기 손실</span><b>${f1(all.waitPM / 60)} MH</b></div>
      <div class="kpi"><span>재작업 손실</span><b>${f1(all.reworkPM / 60)} MH</b></div>
      <div class="kpi"><span>기록된 모듈</span><b>${touched} / ${done}</b></div>
    </div></div>
  <div class="card"><h2>설비 › 모듈 › 조립체 집계</h2><div class="scroll"><table>
    <tr><th>구분</th><th>건수</th><th>인분</th><th>MH</th><th>손실 MH</th></tr>${rows}</table></div>
    <p class="hint">아래 단계의 합이 위 단계와 항상 일치합니다. 손실 = 대기 + 재작업(순공수와 별도).</p></div>
  <div class="card"><h2>공정별</h2><div class="scroll"><table><tr><th>공정</th><th>건수</th><th>인분</th><th>MH</th></tr>
    ${byProc.map(([k, s]) => `<tr><td>${esc(k)}</td><td>${s.count}</td><td>${f1(s.net)}</td><td>${f1(s.mh)}</td></tr>`).join('') || '<tr><td colspan="4" class="mute">기록 없음</td></tr>'}</table></div></div>
  <div class="card"><h2>일자별</h2><div class="scroll"><table><tr><th>날짜</th><th>건수</th><th>MH</th><th>손실 MH</th></tr>
    ${byDate.map(([k, s]) => `<tr><td>${k}</td><td>${s.count}</td><td>${f1(s.mh)}</td><td>${f1(s.lossMH)}</td></tr>`).join('') || '<tr><td colspan="4" class="mute">기록 없음</td></tr>'}</table></div></div>
  <div class="card"><h2>표준공수 <span class="mute">실측 기반 · 전체 프로젝트</span></h2><div class="scroll"><table>
    <tr><th>볼트 · 너트</th><th>건수</th><th>평균(분/개)</th><th>최소~최대</th><th>신뢰도</th></tr>
    ${st.map((s) => `<tr><td>${esc(s.bolt)} · ${esc(s.nut)}</td><td>${s.n}</td><td><b>${s.avg}</b></td><td>${s.min}~${s.max}</td><td><span class="tag ${s.confidence === '높음' ? 'ok' : 'gray'}">${s.confidence}</span></td></tr>`).join('') || '<tr><td colspan="5" class="mute">기록이 쌓이면 자동으로 계산됩니다</td></tr>'}</table></div>
    <p class="hint">출처: 실측(수량 가중 평균). 5건 이상 높음 · 2~4건 보통 · 1건 낮음.</p></div>
  ${an.length ? `<div class="card"><h2>확인이 필요한 기록 <span class="tag bad">${an.length}</span></h2>
    ${an.slice(0, 20).map((a) => `<div class="rec"><div class="t">${esc(a.r.part)} <span class="mute">${a.r.date}</span></div><div class="s">${esc(a.msg)}</div></div>`).join('')}</div>` : ''}
  <div class="card"><button class="btn" data-act="csv-all">이 프로젝트 전체 기록 엑셀(CSV) 받기</button></div>`;
}

/* ───────── 견적 ───────── */
function estBasis(pid) {
  const recs = state.records.filter((r) => r.projectId === pid), s = sumRecords(recs);
  const equipN = new Set(recs.map((r) => r.equipId)).size || 1;
  return {
    recs, s, equipN, perUnit: round2(s.mh / equipN),
    waitRate: s.net ? Math.round(s.waitPM / s.net * 1000) / 10 : 0,
    reworkRate: s.net ? Math.round(s.reworkPM / s.net * 1000) / 10 : 0,
  };
}
function estAutofill() {
  const e = state.est, p = proj(e.projectId); if (!p) return;
  const b = estBasis(p.id);
  e.units = p.equipment.length || 1; e.mhPerUnit = b.perUnit; e.waitRisk = b.waitRate; e.reworkRisk = b.reworkRate;
}
function estLines(e) {
  const b = estBasis(e.projectId), factor = b.perUnit ? e.mhPerUnit / b.perUnit : 0;
  const hourly = e.hours ? e.daily / e.hours : 0;
  return [...new Set(b.recs.map((r) => r.process))].map((k) => {
    const mhUnit = round2(sumRecords(b.recs.filter((r) => r.process === k)).mh / b.equipN * factor);
    return { name: k, mhUnit, mh: round2(mhUnit * e.units), amount: Math.round(mhUnit * e.units * hourly) };
  });
}
function estResHtml() {
  const r = calcEstimate(state.est);
  return `<div class="kpis">
    <div class="kpi big"><span>권장 견적가격 (부가세 별도)</span><b>${won(r.price)}원</b></div>
    <div class="kpi"><span>설비 1대당</span><b>${won(r.perUnitPrice)}원</b></div>
    <div class="kpi"><span>최소 수주 가능가격</span><b>${won(r.minPrice)}원</b></div>
    <div class="kpi"><span>예상 이익</span><b>${won(r.profitAmt)}원</b></div>
    <div class="kpi"><span>예상 이익률</span><b>${r.margin}%</b></div></div>
  <div class="scroll" style="margin-top:10px"><table>
    <tr><td>총 공수</td><td>${f1(r.mh)} MH</td></tr>
    <tr><td>직접노무비 (시간당 ${won(r.hourly)}원)</td><td>${won(r.labor)}</td></tr>
    <tr><td>자재·소모품비</td><td>${won(r.material)}</td></tr>
    <tr><td>장비·운반비</td><td>${won(r.equipCost)}</td></tr>
    <tr><td>간접비</td><td>${won(r.indirect)}</td></tr>
    <tr class="l1"><td>예상 원가</td><td>${won(r.cost)}</td></tr>
    <tr><td>대기·지연 위험</td><td>${won(r.waitCost)}</td></tr>
    <tr><td>예상 재작업 비용</td><td>${won(r.reworkCost)}</td></tr>
    <tr class="l1"><td>위험 포함 예상 원가</td><td>${won(r.riskCost)}</td></tr>
    <tr><td>부가세(10%)</td><td>${won(r.vat)}</td></tr></table></div>`;
}
function viewEstimate() {
  if (!state.projects.length) return '<div class="card"><p class="mute">프로젝트를 먼저 만들어 주세요.</p></div>';
  const e = state.est;
  if (!proj(e.projectId)) { e.projectId = state.draft.projectId || state.projects[0].id; estAutofill(); }
  const b = estBasis(e.projectId);
  const txt = (f, ph) => `<textarea data-bind="est.${f}" placeholder="${ph}">${esc(e[f])}</textarea>`;
  return `
  <div class="card"><h2>턴키 견적 계산</h2>
    ${fld('프로젝트', chips('projectId', state.projects.map((x) => x.id), e.projectId, { root: 'est', fmt: (id) => proj(id)?.name }))}
    <div class="smart"><span>실측 근거: 기록 ${b.s.count}건 · 설비 ${b.equipN}대분 · 1대당 <b>${f1(b.perUnit)} MH</b> · 대기 ${b.waitRate}% · 재작업 ${b.reworkRate}%</span>
      <button class="btn sm navy" data-act="est-auto">실측값 채우기</button></div>
    ${b.s.count === 0 ? '<p class="hint">아직 작업기록이 없어 공수를 직접 입력해야 합니다. 일지가 쌓이면 자동으로 채워집니다.</p>' : ''}
    <div class="grid2">${fld('설비 수량', stepper('units', e.units, 'est'), '대')}${fld('1대당 공수', stepper('mhPerUnit', e.mhPerUnit, 'est'), 'MH')}</div>
    ${fld('노무 일당', chips('daily', DAILIES, e.daily, { root: 'est', fmt: (v) => (v / 10000) + '만' }) + `<div style="height:8px"></div>` + money('daily', e.daily, 'est'), '원 / 8시간')}
    <div class="grid2">${fld('자재·소모품비', money('material', e.material, 'est'), '원')}${fld('장비·운반비', money('equipCost', e.equipCost, 'est'), '원')}</div>
    ${fld('간접비율', chips('indirect', RATES, e.indirect, { root: 'est', unit: '%' }))}
    ${fld('대기·지연 위험률', chips('waitRisk', RATES, e.waitRisk, { root: 'est', unit: '%' }), '노무비 대비')}
    ${fld('재작업 위험률', chips('reworkRisk', RATES, e.reworkRisk, { root: 'est', unit: '%' }), '노무비 대비')}
    ${fld('목표 이익률', chips('profit', RATES, e.profit, { root: 'est', unit: '%' }), '견적가 대비')}
  </div>
  <div class="card"><h2>계산 결과</h2><div id="estres">${estResHtml()}</div></div>
  <div class="card"><h2>견적 조건</h2>
    ${fld('수신(고객사)', `<input type="text" value="${esc(e.client)}" data-bind="est.client">`, '선택')}
    ${fld('작업 범위', txt('scope', '예: 입고 후 조립·설치·레벨링까지'))}
    ${fld('제외 공정', txt('excluded', '예: 전장 배선, 시운전'))}
    ${fld('대금 지급 조건', txt('payment', '예: 선금 30% / 검수 후 70%'))}
    ${fld('검수 조건', txt('inspection', ''))}
    ${fld('하자 책임', txt('warranty', ''))}
    <button class="btn pri block" style="margin-top:14px" data-act="est-save">견적 저장</button>
    <p class="hint">저장 시점의 공수·단가가 함께 보존되어, 나중에 기준이 바뀌어도 같은 견적을 다시 출력할 수 있습니다.</p>
  </div>
  <div class="card"><h2>저장된 견적</h2>
    ${state.estimates.slice().reverse().map((x) => `<div class="rec"><div class="row between"><div><div class="t">${esc(x.no)} · ${esc(x.projectName)}</div>
      <div class="s">${x.createdAt.slice(0, 10)} · ${f1(x.result.mh)} MH · 이익률 ${x.result.margin}%</div></div><div class="n">${won(x.result.price)}원</div></div>
      <div class="row" style="margin-top:7px"><button class="btn sm navy" data-act="est-print" data-id="${x.id}">견적서 PDF·인쇄</button>
        <button class="btn sm" data-act="est-csv" data-id="${x.id}">엑셀(CSV)</button>
        <button class="btn sm" data-act="est-load" data-id="${x.id}">불러오기</button>
        <button class="btn sm danger" data-act="est-del" data-id="${x.id}">${dangerLabel('est' + x.id, '삭제')}</button></div></div>`).join('') || '<p class="mute">저장된 견적이 없습니다.</p>'}
  </div>`;
}
function estRows(x) {
  const r = x.result, i = x.inputs;
  return [['견적번호', x.no], ['작성일', x.createdAt.slice(0, 10)], ['프로젝트', x.projectName], ['수신', i.client], [],
    ['공정', '1대당 공수(MH)', '수량(대)', '총 공수(MH)', '노무비(원)'],
    ...x.lines.map((l) => [l.name, l.mhUnit, i.units, l.mh, l.amount]), [],
    ['항목', '금액(원)'], ['직접노무비', r.labor], ['자재·소모품비', r.material], ['장비·운반비', r.equipCost], ['간접비', r.indirect],
    ['예상 원가', r.cost], ['대기·지연 위험', r.waitCost], ['예상 재작업 비용', r.reworkCost], ['위험 포함 예상 원가', r.riskCost],
    ['목표 이익', r.profitAmt], ['견적가격(부가세 별도)', r.price], ['부가세', r.vat], ['합계(부가세 포함)', r.price + r.vat], [],
    ['작업 범위', i.scope], ['제외 공정', i.excluded], ['대금 지급 조건', i.payment], ['검수 조건', i.inspection], ['하자 책임', i.warranty]];
}
function printEstimate(x) {
  const r = x.result, i = x.inputs;
  const term = (t, v) => (v ? `<h2>${t}</h2><p>${esc(v)}</p>` : '');
  $('#print').innerHTML = `<h1>견 적 서</h1>
    <table class="meta"><tr><th>견적번호</th><td>${esc(x.no)}</td><th>작성일</th><td>${x.createdAt.slice(0, 10)}</td></tr>
      <tr><th>수신</th><td>${esc(i.client)}</td><th>공급자</th><td>${esc(state.settings.company || state.settings.worker)}</td></tr>
      <tr><th>건명</th><td colspan="3">${esc(x.projectName)} (설비 ${i.units}대)</td></tr></table>
    <h2>견적 금액</h2><table><tr class="total"><td>견적가격 (부가세 별도)</td><td>${won(r.price)} 원</td></tr>
      <tr><td>부가세</td><td>${won(r.vat)} 원</td></tr><tr class="total"><td>합계</td><td>${won(r.price + r.vat)} 원</td></tr>
      <tr><td>설비 1대당 (부가세 별도)</td><td>${won(r.perUnitPrice)} 원</td></tr></table>
    <h2>공정별 내역</h2><table><tr><th>공정</th><th>1대당 공수(MH)</th><th>수량</th><th>총 공수(MH)</th></tr>
      ${x.lines.map((l) => `<tr><td>${esc(l.name)}</td><td>${f1(l.mhUnit)}</td><td>${i.units}</td><td>${f1(l.mh)}</td></tr>`).join('')}
      <tr class="total"><td>계</td><td>${f1(i.mhPerUnit)}</td><td>${i.units}</td><td>${f1(r.mh)}</td></tr></table>
    ${term('작업 범위', i.scope)}${term('제외 공정', i.excluded)}${term('대금 지급 조건', i.payment)}${term('검수 조건', i.inspection)}${term('하자 책임', i.warranty)}`;
  window.print();
}

/* ───────── 설정 ───────── */
function viewSettings() {
  const s = state.settings;
  return `
  <div class="card"><button class="btn navy block" data-act="tab" data-tab="help">❓ 사용 설명서 보기</button></div>
  <div class="card"><h2>내 정보</h2>
    ${fld('작업자 이름', `<input type="text" value="${esc(s.worker)}" data-bind="settings.worker">`, '일지·견적서에 표시')}
    ${fld('상호', `<input type="text" value="${esc(s.company)}" data-bind="settings.company">`, '견적서 공급자')}
  </div>
  <div class="card"><h2>선택 항목 관리</h2><p class="mute">일지에서 고르는 버튼 목록입니다. 눌러서 삭제, ＋로 추가.</p>
    ${Object.keys(OPT_LABEL).map((k) => `<h3>${OPT_LABEL[k]}</h3><div class="chips">
      ${O(k).map((x, i) => `<button class="chip${ui.confirm === 'opt' + k + i ? ' del' : ''}" data-act="opt-del" data-k="${k}" data-i="${i}">${esc(x)}${ui.confirm === 'opt' + k + i ? ' ✕' : ''}</button>`).join('')}
      <button class="chip add" data-act="addopt" data-k="${k}" data-f="_">＋</button></div>
      ${ui.adding === k + ':_' ? `<div class="addbox"><input id="addinp" type="${NUM_OPT.has(k) ? 'number' : 'text'}" step="any" placeholder="새 항목"><button class="btn navy" data-act="addok" data-k="${k}" data-f="_">추가</button></div>` : ''}`).join('')}
  </div>
  <div class="card"><h2>데이터 백업</h2>
    <p class="mute">현재 데이터는 이 기기의 브라우저에 저장됩니다. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 백업 파일을 받아 두세요.</p>
    <div class="row"><button class="btn navy" data-act="backup">백업 파일 받기</button>
      <label class="btn" style="display:inline-flex;align-items:center">백업 불러오기<input type="file" accept="application/json" id="restore" hidden></label>
      <button class="btn danger" data-act="reset">${dangerLabel('reset', '전체 초기화')}</button></div>
    <p class="hint">기록 ${state.records.length}건 · 프로젝트 ${state.projects.length}개 · 견적 ${state.estimates.length}건</p>
  </div>`;
}

/* ───────── 사용법 ───────── */
function viewHelp() {
  const step = (n, t) => `<div class="stepn"><b>${n}</b><div>${t}</div></div>`;
  const go = (tab, label) => `<button class="btn navy block" style="margin-top:12px" data-act="tab" data-tab="${tab}">${label}</button>`;
  return `<div class="help">
  <div class="card"><h2>📘 이 앱은 무엇을 하나요?</h2>
    <p>오늘 내가 <b>무슨 일을, 몇 개나, 얼마나 걸려서</b> 했는지 적어 두는 <b>일기장</b>이에요.</p>
    <p>매일 적어 두면 앱이 알아서 더해 주고, 나중에 <b>"이 일은 얼마를 받아야 할까?"</b>도 계산해 줘요.</p>
    <p>글자는 거의 안 써도 돼요. <b>버튼을 콕콕 누르기만</b> 하면 됩니다.</p></div>

  <div class="card"><h2>👇 화면 맨 아래 버튼 5개</h2>
    <div class="word"><b>✎ 일지</b> — 오늘 한 일을 적는 곳 (매일 쓰는 곳)</div>
    <div class="word"><b>▦ 프로젝트</b> — 일하는 곳의 이름을 만드는 곳 (처음에 한 번)</div>
    <div class="word"><b>Σ 집계</b> — 지금까지 한 일을 모두 더해서 보여 주는 곳</div>
    <div class="word"><b>₩ 견적</b> — 받을 돈을 계산하는 곳</div>
    <div class="word"><b>⚙ 설정</b> — 내 이름을 쓰고, 버튼을 고치고, 기록을 보관하는 곳</div></div>

  <div class="card"><h2>1단계 · 처음에 딱 한 번, 프로젝트 만들기</h2>
    <p>프로젝트는 <b>"이번에 맡은 일의 이름"</b>이에요. 공책에 과목 이름을 쓰는 것과 같아요.</p>
    ${step(1, '아래 <span class="k">▦ 프로젝트</span>를 눌러요.')}
    ${step(2, '<b>프로젝트명</b>에 이름을 써요. 내가 알아볼 수 있으면 아무 이름이나 좋아요.')}
    ${step(3, '<b>설비 수량</b>은 기계가 몇 대인지, <b>설비당 모듈 수</b>는 기계 한 대가 몇 덩어리로 나뉘는지 <span class="k">−</span> <span class="k">＋</span>로 맞춰요.')}
    ${step(4, '주황색 <span class="k o">프로젝트 만들기</span>를 눌러요. 끝!')}
    <div class="ex">💡 기계 2대, 한 대에 덩어리 3개라면 → 설비 수량 <b>2</b>, 모듈 수 <b>3</b></div>
    ${go('projects', '프로젝트 만들러 가기')}</div>

  <div class="card"><h2>2단계 · 매일, 일지 쓰기</h2>
    <p>부품 <b>한 가지</b>를 조립할 때마다 <b>한 번</b> 적어요.</p>
    ${step(1, '아래 <span class="k">✎ 일지</span>를 눌러요.')}
    ${step(2, '<b>프로젝트 · 설비 · 모듈</b>에서 지금 일하는 곳을 눌러요.')}
    ${step(3, '<b>부품명</b>에 조립한 부품 이름을 써요. <b>글자를 쓰는 곳은 여기 하나뿐</b>이에요.')}
    ${step(4, '<b>볼트</b> 크기를 눌러요. (예: <span class="k">M8</span>) 볼트를 안 썼으면 <span class="k">없음</span>.')}
    ${step(5, '<b>너트</b>를 눌러요. 너트가 없으면 <span class="k">없음</span>.')}
    ${step(6, '<b>체결 수량</b>에서 볼트를 몇 개 조였는지 눌러요.')}
    ${step(7, '<b>볼트 1개당 조립시간</b>에서 볼트 하나 조이는 데 걸린 시간을 눌러요.')}
    ${step(8, '<b>작업 인원</b>에서 몇 명이 같이 했는지 눌러요.')}
    ${step(9, '주황색 <span class="k o">일지에 저장</span>을 눌러요. 끝!')}
    <div class="ex">💡 <b>계산은 앱이 해 줘요.</b><br>볼트 24개 × 한 개에 0.8분 = <b>19.2분</b><br>저장 버튼 바로 위 남색 상자에 답이 바로 보여요.</div>
    <div class="ex">💡 원하는 숫자가 버튼에 없으면 줄 끝의 <span class="k">＋</span>를 눌러서 새 버튼을 만들어요. 다음부터는 그 버튼이 계속 나와요.</div>
    <div class="ex">💡 전에 썼던 부품 이름을 또 쓰면, 그때 골랐던 것들이 <b>저절로</b> 골라져요.</div>
    ${go('log', '일지 쓰러 가기')}</div>

  <div class="card"><h2>일지에서 더 고를 수 있는 것</h2>
    <p>몰라도 괜찮아요. 안 누르면 0으로 계산돼요.</p>
    <div class="word"><b>준비시간</b> — 공구와 부품을 챙기는 데 걸린 시간</div>
    <div class="word"><b>검사시간</b> — 잘 됐는지 확인하는 데 걸린 시간</div>
    <div class="word"><b>대기시간</b> — 일을 못 하고 기다린 시간</div>
    <div class="word"><b>재작업시간</b> — 잘못돼서 다시 한 시간</div>
    <div class="word"><b>날짜 ◀ ▶</b> — 어제나 다른 날 일지를 볼 때 눌러요. <span class="k">오늘</span>을 누르면 오늘로 돌아와요.</div>
    <div class="word"><b>수정 · 삭제</b> — 잘못 적었으면 아래 목록에서 <span class="k">수정</span>을 눌러요. <span class="k">삭제</span>는 실수로 지우지 않게 <b>두 번</b> 눌러야 지워져요.</div></div>

  <div class="card"><h2>3단계 · 얼마나 했는지 보기</h2>
    ${step(1, '아래 <span class="k">Σ 집계</span>를 눌러요.')}
    ${step(2, '기계별, 덩어리(모듈)별로 일한 시간이 <b>저절로 더해져</b> 있어요.')}
    <p>일지를 많이 쓸수록 "볼트 하나에 보통 몇 분 걸리는지"를 앱이 더 정확하게 알려 줘요.</p></div>

  <div class="card"><h2>4단계 · 받을 돈 계산하기</h2>
    ${step(1, '아래 <span class="k">₩ 견적</span>을 눌러요.')}
    ${step(2, '<span class="k">실측값 채우기</span>를 누르면 일지에 적은 시간이 자동으로 들어가요.')}
    ${step(3, '<b>노무 일당</b>(하루 일한 값)과 <b>목표 이익률</b>(남기고 싶은 만큼)을 눌러요.')}
    ${step(4, '<b>권장 견적가격</b>이 바로 나와요. 이 값이 "이만큼 받으면 좋아요"라는 뜻이에요.')}
    ${step(5, '<span class="k o">견적 저장</span>을 누른 뒤 <span class="k">견적서 PDF·인쇄</span>를 누르면 종이로 뽑을 수 있어요.')}</div>

  <div class="card"><h2>📖 어려운 낱말 풀이</h2>
    <div class="word"><b>설비</b> — 기계 한 대</div>
    <div class="word"><b>모듈</b> — 기계를 이루는 큰 덩어리</div>
    <div class="word"><b>조립체</b> — 덩어리 안의 작은 묶음</div>
    <div class="word"><b>체결</b> — 볼트를 돌려서 꽉 조이는 것</div>
    <div class="word"><b>인분</b> — 한 사람이 1분 동안 하는 일. 2명이 10분 일하면 20인분이에요.</div>
    <div class="word"><b>MH</b> — 한 사람이 1시간 동안 하는 일. 60인분 = 1MH예요.</div>
    <div class="word"><b>공수</b> — 일을 끝내는 데 든 사람의 시간</div>
    <div class="word"><b>견적</b> — "이 일은 이만큼 받겠습니다" 하고 미리 알려 주는 값</div>
    <div class="word"><b>원가</b> — 일을 하는 데 실제로 드는 돈</div></div>

  <div class="card"><h2>⚠️ 꼭 기억하세요</h2>
    <p><b>적은 내용은 이 휴대폰 안에만 저장돼요.</b> 휴대폰을 바꾸거나 인터넷 기록을 지우면 사라질 수 있어요.</p>
    <p>가끔 <span class="k">⚙ 설정</span> → <span class="k">백업 파일 받기</span>를 눌러서 보관해 두세요. 숙제를 가방에 한 번 더 챙기는 것과 같아요.</p>
    <p>사진을 찍거나 녹음하면 안 되는 곳에서는 <b>회사 규칙을 먼저</b> 지켜요.</p>
    ${go('settings', '설정으로 가기')}</div>
  </div>`;
}

/* ───────── 렌더 ───────── */
const VIEWS = { log: viewLog, projects: viewProjects, summary: viewSummary, estimate: viewEstimate, settings: viewSettings, help: viewHelp };
function header() {
  const s = sumRecords(state.records.filter((r) => r.date === today()));
  $('#today-mh').innerHTML = `오늘<b>${f1(s.mh)} MH</b>`;
  $('#sub').textContent = state.settings.worker ? state.settings.worker + ' 님' : '공수·견적 관리';
}
function render() {
  $('#view').innerHTML = VIEWS[ui.tab]();
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  header();
  const a = $('#addinp'); if (a) a.focus();
}
function live() {
  if (ui.tab === 'log' && $('#live')) $('#live').innerHTML = liveHtml();
  if (ui.tab === 'estimate' && $('#estres')) $('#estres').innerHTML = estResHtml();
}
function setField(rootName, f, raw) {
  const r = roots()[rootName], v = NUM_F.has(f) ? Number(raw) || 0 : raw;
  r[f] = v;
  if (rootName === 'draft') {
    if (f === 'projectId') { r.equipId = null; r.moduleId = null; }
    if (f === 'equipId') r.moduleId = null;
    if (f === 'bolt' && v === '없음') { r.length = null; r.nut = '없음'; r.washer = '없음'; r.tool = null; }
  }
  if (rootName === 'est' && f === 'projectId') estAutofill();
}

/* ───────── 동작 ───────── */
const ACT = {
  tab: (d) => { ui.tab = d.tab; window.scrollTo(0, 0); },
  set: (d) => setField(d.root || 'draft', d.f, d.v),
  step: (d) => { const r = roots()[d.root]; r[d.f] = Math.max(0, round2((Number(r[d.f]) || 0) + Number(d.d))); },
  addopt: (d) => { const k = d.k + ':' + d.f; ui.adding = ui.adding === k ? null : k; },
  addok: (d) => {
    let v = $('#addinp').value.trim(); if (!v) return;
    if (NUM_OPT.has(d.k)) { v = Number(v); if (!(v >= 0)) return; }
    const list = O(d.k);
    if (!list.some((x) => String(x) === String(v))) { list.push(v); if (NUM_OPT.has(d.k)) list.sort((a, b) => a - b); }
    if (d.f !== '_') setField(d.root || 'draft', d.f, v);
    ui.adding = null;
  },
  day: (d) => {
    if (d.d === '0') state.draft.date = today();
    else { const t = new Date(state.draft.date + 'T12:00:00'); t.setDate(t.getDate() + Number(d.d)); state.draft.date = t.toISOString().slice(0, 10); }
  },
  'save-rec': () => {
    const d = state.draft;
    d.part = (d.part || '').trim();
    if (!d.part) { toast('부품명을 입력해 주세요'); $('input.part')?.focus(); return false; }
    if (!d.moduleId) { toast('설비와 모듈을 선택해 주세요'); return false; }
    const { editId, ...data } = d, now = new Date().toISOString();
    if (editId) Object.assign(state.records.find((r) => r.id === editId), data, { updatedAt: now });
    else state.records.push({ ...data, id: uid(), worker: state.settings.worker, createdAt: now, updatedAt: now });
    const c = calcRecord(d);
    // 다음 기록을 빨리 쓰도록 위치·공정·인원은 유지하고 부품 관련 값만 비움
    state.draft = newDraft({ date: d.date, projectId: d.projectId, equipId: d.equipId, moduleId: d.moduleId, assembly: d.assembly, process: d.process, workers: d.workers, access: d.access });
    ui.autofill = null;
    toast(`저장됨 · ${c.net}인분 (${c.mh} MH)`);
  },
  'cancel-edit': () => { const d = state.draft; state.draft = newDraft({ date: d.date, projectId: d.projectId, equipId: d.equipId, moduleId: d.moduleId }); },
  'edit-rec': (d) => { const r = state.records.find((x) => x.id === d.id); state.draft = { ...newDraft(), ...r, editId: r.id }; window.scrollTo(0, 0); },
  'dup-rec': (d) => { const { id, createdAt, updatedAt, worker, ...r } = state.records.find((x) => x.id === d.id); state.draft = { ...newDraft(), ...r, date: state.draft.date, editId: null }; window.scrollTo(0, 0); toast('내용을 불러왔습니다. 확인 후 저장하세요'); },
  'del-rec': (d) => twoStep('rec' + d.id, () => { state.records = state.records.filter((r) => r.id !== d.id); if (state.draft.editId === d.id) state.draft.editId = null; }),
  'copy-prev': (d) => {
    const now = new Date().toISOString();
    const copies = state.records.filter((r) => r.date === d.date).map((r) => ({ ...r, id: uid(), date: state.draft.date, createdAt: now, updatedAt: now }));
    state.records.push(...copies); toast(`${copies.length}건을 가져왔습니다. 다른 부분만 수정하세요`);
  },
  'text-day': async () => {
    const t = dayText(state.draft.date);
    try { await navigator.clipboard.writeText(t); toast('일지를 복사했습니다'); } catch { download(`작업일지_${state.draft.date}.txt`, t, 'text/plain'); }
    return false;
  },
  'csv-day': () => { download(`작업일지_${state.draft.date}.csv`, csv(recordRows(state.records.filter((r) => r.date === state.draft.date)))); return false; },
  'csv-all': () => { const p = proj(ui.sumProj); download(`작업기록_${p.name}.csv`, csv(recordRows(state.records.filter((r) => r.projectId === p.id)))); return false; },

  'proj-create': () => {
    const f = ui.pform; f.name = f.name.trim();
    if (!f.name) { toast('프로젝트명을 입력해 주세요'); return false; }
    const eN = Math.max(1, Math.round(f.equipCount)), mN = Math.max(1, Math.round(f.moduleCount));
    const p = { id: uid(), name: f.name, code: f.code, type: f.type, status: f.status, start: f.start, due: f.due, contract: f.contract, targetCost: f.targetCost, createdAt: new Date().toISOString(),
      equipment: Array.from({ length: eN }, (_, i) => ({ id: uid(), name: `설비 ${i + 1}`, modules: mkModules(mN) })) };
    state.projects.push(p); ui.pform = newPform(); ui.open = p.id;
    state.draft.projectId = p.id; state.draft.equipId = null; state.draft.moduleId = null;
    toast('프로젝트를 만들었습니다. 일지 탭에서 기록을 시작하세요');
  },
  'proj-open': (d) => { ui.open = ui.open === d.id ? null : d.id; },
  'proj-status': (d) => { proj(d.id).status = d.v; },
  'proj-dup': (d) => {
    const s = proj(d.id);
    const p = { ...s, id: uid(), name: s.name + ' (복제)', status: '준비', createdAt: new Date().toISOString(),
      equipment: s.equipment.map((e) => ({ id: uid(), name: e.name, modules: e.modules.map((m) => ({ id: uid(), name: m.name })) })) };
    state.projects.push(p); ui.open = p.id; toast('설비·모듈 구성을 복제했습니다');
  },
  'proj-del': (d) => twoStep('proj' + d.id, () => {
    state.projects = state.projects.filter((p) => p.id !== d.id); state.records = state.records.filter((r) => r.projectId !== d.id);
    toast('프로젝트와 해당 기록을 삭제했습니다');
  }),
  'eq-add': (d) => { const p = proj(d.p); p.equipment.push({ id: uid(), name: `설비 ${p.equipment.length + 1}`, modules: mkModules(p.equipment.at(-1)?.modules.length || 1) }); },
  'eq-del': (d) => {
    if (state.records.some((r) => r.equipId === d.e)) { toast('작업기록이 있는 설비는 삭제할 수 없습니다'); return false; }
    return twoStep('eq' + d.e, () => { const p = proj(d.p); p.equipment = p.equipment.filter((e) => e.id !== d.e); });
  },
  'mod-add': (d) => { const e = equip(proj(d.p), d.e); e.modules.push({ id: uid(), name: `모듈 ${e.modules.length + 1}` }); },
  'mod-del': (d) => {
    if (state.records.some((r) => r.moduleId === d.m)) { toast('작업기록이 있는 모듈은 삭제할 수 없습니다'); return false; }
    return twoStep('mod' + d.m, () => { const e = equip(proj(d.p), d.e); e.modules = e.modules.filter((m) => m.id !== d.m); });
  },

  'est-auto': () => { estAutofill(); toast('실측값으로 채웠습니다'); },
  'est-save': () => {
    const e = state.est, p = proj(e.projectId);
    if (!e.mhPerUnit) { toast('1대당 공수를 입력해 주세요'); return false; }
    const no = 'Q' + today().replace(/-/g, '') + '-' + String(state.estimates.length + 1).padStart(2, '0');
    state.estimates.push({ id: uid(), no, createdAt: new Date().toISOString(), projectId: p.id, projectName: p.name,
      inputs: structuredClone(e), result: calcEstimate(e), lines: estLines(e), standards: stds(), eff: structuredClone(state.settings.eff) });
    toast(`견적 ${no} 저장됨`);
  },
  'est-print': (d) => { printEstimate(state.estimates.find((x) => x.id === d.id)); return false; },
  'est-csv': (d) => { const x = state.estimates.find((y) => y.id === d.id); download(`견적서_${x.no}.csv`, csv(estRows(x))); return false; },
  'est-load': (d) => { state.est = structuredClone(state.estimates.find((x) => x.id === d.id).inputs); window.scrollTo(0, 0); toast('견적 조건을 불러왔습니다'); },
  'est-del': (d) => twoStep('est' + d.id, () => { state.estimates = state.estimates.filter((x) => x.id !== d.id); }),

  'opt-del': (d) => twoStep('opt' + d.k + d.i, () => { if (O(d.k).length > 1) O(d.k).splice(Number(d.i), 1); }),
  backup: () => { download(`작업오더_백업_${today()}.json`, JSON.stringify(state), 'application/json'); return false; },
  reset: () => twoStep('reset', () => { localStorage.removeItem(KEY); state = load(); toast('초기화했습니다'); }),
};
let keepConfirm = false;
function twoStep(key, fn) {
  if (ui.confirm === key) { ui.confirm = null; fn(); } else { ui.confirm = key; keepConfirm = true; }
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act],[data-tab]'); if (!el) return;
  const d = { ...el.dataset }, act = d.act || 'tab';
  keepConfirm = false;
  const res = await ACT[act]?.(d);
  if (!keepConfirm) ui.confirm = null;
  if (act === 'set' || act === 'tab') ui.adding = null;
  save();
  if (res !== false || keepConfirm) render();
});
document.addEventListener('input', (ev) => {
  const b = ev.target.dataset.bind; if (!b) return;
  const [rootName, f] = b.split('.');
  setField(rootName, f, ev.target.value);
  save(); live();
  // 직접 입력한 값과 선택 버튼 표시를 맞춤 (화면 전체를 다시 그리면 이어지는 터치가 끊김)
  document.querySelectorAll(`.chip[data-act="set"][data-f="${f}"]`).forEach((c) => { if ((c.dataset.root || 'draft') === rootName) c.classList.toggle('on', c.dataset.v === String(ev.target.value)); });
  if (rootName === 'settings') header();
});
document.addEventListener('change', (ev) => {
  const t = ev.target, ds = t.dataset;
  if (ds.part) { // 같은 부품명을 다시 쓰면 지난번 선택값을 불러옴
    const name = t.value.trim(), d = state.draft;
    const last = name && !d.editId && state.records.filter((r) => r.part === name).pop();
    if (last) {
      for (const k of ['bolt', 'length', 'nut', 'washer', 'tool', 'qty', 'per', 'prep', 'inspect', 'process', 'assembly']) d[k] = last[k];
      ui.autofill = name; save(); render();
    } else if (ui.autofill) { ui.autofill = null; render(); }
  } else if (ds.rerender) { render(); }
  else if (ds.pe) { const p = proj(ds.pe); p[ds.k] = NUM_F.has(ds.k) ? Number(t.value) || 0 : (t.value.trim() || p[ds.k]); save(); }
  else if (ds.ee) { const [p, e] = ds.ee.split('|'); const x = equip(proj(p), e); x.name = t.value.trim() || x.name; save(); }
  else if (ds.me) { const [p, e, m] = ds.me.split('|'); const x = modu(equip(proj(p), e), m); x.name = t.value.trim() || x.name; save(); }
  else if (t.id === 'restore' && t.files[0]) {
    t.files[0].text().then((txt) => {
      try { const s = JSON.parse(txt); if (!Array.isArray(s.records) || !Array.isArray(s.projects)) throw 0; localStorage.setItem(KEY, txt); state = load(); render(); toast('백업을 불러왔습니다'); }
      catch { toast('백업 파일 형식이 올바르지 않습니다'); }
    });
  }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.id === 'addinp') ev.target.nextElementSibling.click();
  if (ev.key === 'Enter' && ev.target.dataset.part) ev.target.blur();
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
