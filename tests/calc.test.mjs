// 실행: node tests/calc.test.mjs
import assert from 'node:assert/strict';
import { calcRecord, sumRecords, buildStandards, calcEstimate, findAnomalies } from '../js/calc.js';

// 인수인계서 완료 기준: 24개 × 0.8분 = 19.2인분, 준비 12 + 검사 6 → 37.2인분 = 0.62MH
const r = { qty: 24, per: 0.8, prep: 12, inspect: 6, workers: 2, wait: 10, rework: 0, bolt: 'M8', nut: '없음' };
const c = calcRecord(r, { 2: 0.9 });
assert.equal(c.repeat, 19.2);
assert.equal(c.net, 37.2);
assert.equal(c.mh, 0.62);
assert.equal(c.waitPM, 20);            // 대기 10분 × 2명, 순공수와 별도
assert.equal(c.total, 57.2);           // 중복 합산 없음
assert.equal(c.elapsed, 30.67);        // 37.2 ÷ (2명×0.9) + 대기 10분

// 부품 → 모듈 → 설비 → 프로젝트 집계 일치
const recs = [
  { ...r, equipId: 'e1', moduleId: 'm1' },
  { ...r, equipId: 'e1', moduleId: 'm2', qty: 10 },
  { ...r, equipId: 'e2', moduleId: 'm3', qty: 5, per: 1.5 },
];
const all = sumRecords(recs);
const byEquip = ['e1', 'e2'].map((e) => sumRecords(recs.filter((x) => x.equipId === e)));
const byModule = ['m1', 'm2', 'm3'].map((m) => sumRecords(recs.filter((x) => x.moduleId === m)));
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.011, `${a} != ${b}`);
close(all.net, byEquip.reduce((a, s) => a + s.net, 0));
close(all.net, byModule.reduce((a, s) => a + s.net, 0));
close(all.total, byModule.reduce((a, s) => a + s.total, 0));

// 표준공수: 수량 가중 평균
const std = buildStandards(recs);
assert.equal(std.length, 1);
assert.equal(std[0].avg, 0.89); // (24×0.8 + 10×0.8 + 5×1.5) ÷ 39
assert.equal(std[0].confidence, '보통');
assert.ok(findAnomalies(recs, std).some((a) => a.msg.includes('1.5배')));

// 견적
const e = calcEstimate({ mhPerUnit: 100, units: 2, daily: 200000, hours: 8, material: 500000, equipCost: 300000, indirect: 10, waitRisk: 10, reworkRisk: 5, profit: 20 });
assert.equal(e.mh, 200);
assert.equal(e.labor, 5000000);
assert.equal(e.cost, 6380000);          // (500만+50만+30만) × 1.1
assert.equal(e.riskCost, 7130000);      // + 대기 50만 + 재작업 25만
assert.equal(e.price, 8913000);         // ÷ 0.8, 천원 올림
assert.ok(e.margin > 19.9 && e.margin <= 20.01);

console.log('계산 엔진 테스트 전부 통과');
