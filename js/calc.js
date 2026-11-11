// 공수·견적 계산 엔진 (화면과 분리된 순수 함수 — 브라우저와 테스트에서 함께 사용)

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => Number(v) || 0;

// 작업기록 1건의 공수 계산
// 반복작업 인분 = 수량 × 개당 작업시간(분)
// 순공수(인분) = 준비 + 반복 + 검사 + 기타
// 대기·재작업은 순공수와 별도 집계(중복 합산 없음): 시간(분) × 인원
export function calcRecord(r, eff = {}) {
  const workers = Math.max(1, num(r.workers) || 1);
  const repeat = round2(num(r.qty) * num(r.per));
  const net = round2(num(r.prep) + repeat + num(r.inspect) + num(r.extra));
  const waitPM = round2(num(r.wait) * workers);
  const reworkPM = round2(num(r.rework) * workers);
  const e = Number(eff[workers]) || 1;
  // 인원이 늘어도 시간이 정비례로 줄지 않으므로 협업 효율을 반영
  const elapsed = round2(net / (workers * e) + num(r.wait) + num(r.rework));
  return {
    repeat, net, waitPM, reworkPM,
    total: round2(net + waitPM + reworkPM),
    mh: round2(net / 60),
    elapsed,
  };
}

// 여러 기록 합산
export function sumRecords(list, eff = {}) {
  const s = { count: 0, net: 0, waitPM: 0, reworkPM: 0, total: 0, qty: 0 };
  for (const r of list) {
    const c = calcRecord(r, eff);
    s.count += 1;
    s.net += c.net; s.waitPM += c.waitPM; s.reworkPM += c.reworkPM; s.total += c.total;
    s.qty += num(r.qty);
  }
  for (const k of ['net', 'waitPM', 'reworkPM', 'total']) s[k] = round2(s[k]);
  s.mh = round2(s.net / 60);
  s.lossMH = round2((s.waitPM + s.reworkPM) / 60);
  return s;
}

// 표준공수: 볼트 규격 + 너트 조합별 실측 개당 시간(수량 가중 평균)
export function standardKey(r) {
  return [r.bolt || '없음', r.nut || '없음'].join('|');
}
export function buildStandards(records) {
  const map = {};
  for (const r of records) {
    if (!num(r.qty) || !num(r.per)) continue;
    const k = standardKey(r);
    const m = (map[k] ||= { key: k, bolt: r.bolt || '없음', nut: r.nut || '없음', n: 0, qty: 0, sum: 0, min: Infinity, max: 0 });
    m.n += 1; m.qty += num(r.qty); m.sum += num(r.qty) * num(r.per);
    m.min = Math.min(m.min, num(r.per)); m.max = Math.max(m.max, num(r.per));
  }
  return Object.values(map).map((m) => ({
    ...m,
    avg: round2(m.sum / m.qty),
    confidence: m.n >= 5 ? '높음' : m.n >= 2 ? '보통' : '낮음',
  })).sort((a, b) => a.key.localeCompare(b.key, 'ko', { numeric: true }));
}

// 이상 감지: 표준 대비 지나치게 긴 개당 시간, 재작업 과다, 수량 누락
export function findAnomalies(records, standards) {
  const std = Object.fromEntries(standards.map((s) => [s.key, s]));
  const out = [];
  for (const r of records) {
    const s = std[standardKey(r)];
    if (!num(r.qty)) out.push({ r, msg: '수량이 0입니다' });
    if (s && s.n >= 3 && num(r.per) > s.avg * 1.5) out.push({ r, msg: `개당 ${r.per}분 — 실측 평균 ${s.avg}분의 1.5배 초과` });
    const c = calcRecord(r);
    if (c.net > 0 && c.reworkPM > c.net * 0.3) out.push({ r, msg: '재작업이 순공수의 30%를 넘습니다' });
  }
  return out;
}

// 턴키 견적 계산
export function calcEstimate(i) {
  const mh = round2(num(i.mhPerUnit) * num(i.units));
  const hourly = num(i.hours) ? num(i.daily) / num(i.hours) : 0;
  const labor = Math.round(mh * hourly);
  const direct = labor + num(i.material) + num(i.equipCost);
  const indirect = Math.round(direct * num(i.indirect) / 100);
  const cost = direct + indirect;
  const waitCost = Math.round(labor * num(i.waitRisk) / 100);
  const reworkCost = Math.round(labor * num(i.reworkRisk) / 100);
  const riskCost = cost + waitCost + reworkCost;
  const p = Math.min(num(i.profit), 90) / 100;
  const price = Math.ceil(riskCost / (1 - p) / 1000) * 1000; // 천원 단위 올림
  const profitAmt = price - riskCost;
  return {
    mh, hourly: Math.round(hourly), labor, material: num(i.material), equipCost: num(i.equipCost),
    indirect, cost, waitCost, reworkCost, riskCost,
    minPrice: riskCost, price, profitAmt,
    margin: price ? round2(profitAmt / price * 100) : 0,
    vat: Math.round(price * 0.1),
    perUnitPrice: num(i.units) ? Math.round(price / num(i.units)) : 0,
  };
}
