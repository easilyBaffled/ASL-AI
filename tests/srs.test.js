import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleSim, isDue, recognize } from '../src/utils/srs.js';

const start = '2025-01-01';

test('first success -> interval 1', () => {
  let item = { ease: 2.3, intervalDays: 0, due: start, streak: 0 };
  item = scheduleSim(item, true, start);
  assert.equal(item.intervalDays, 1);
  assert.equal(item.streak, 1);
});

test('second success -> interval 3', () => {
  let item = { ease: 2.3, intervalDays: 1, due: start, streak: 1 };
  item = scheduleSim(item, true, start);
  assert.equal(item.intervalDays, 3);
  assert.equal(item.streak, 2);
});

test('third success -> ~7 days and ease increase', () => {
  let item = { ease: 2.3, intervalDays: 3, due: start, streak: 2 };
  const prevEase = item.ease;
  item = scheduleSim(item, true, start);
  assert.ok(item.intervalDays >= 6 && item.intervalDays <= 8);
  assert.ok(item.ease > prevEase);
});

test('failure -> interval 1, ease down', () => {
  let item = { ease: 2.5, intervalDays: 7, due: start, streak: 3 };
  const prevEase = item.ease;
  item = scheduleSim(item, false, start);
  assert.equal(item.intervalDays, 1);
  assert.ok(item.ease <= prevEase);
});

test('isDue respects dates', () => {
  const dueNow = { ease: 2.3, intervalDays: 0, due: '2025-01-01', streak: 0 };
  const dueFuture = { ease: 2.3, intervalDays: 3, due: '2025-02-01', streak: 2 };
  assert.equal(isDue(dueNow, '2025-01-02'), true);
  assert.equal(isDue(dueFuture, '2025-01-02'), false);
});

test('ease bounds respected', () => {
  let bounds = { ease: 2.79, intervalDays: 10, due: start, streak: 5 };
  bounds = scheduleSim(bounds, true, start);
  assert.ok(bounds.ease <= 2.8);
  bounds = { ease: 1.31, intervalDays: 1, due: start, streak: 0 };
  bounds = scheduleSim(bounds, false, start);
  assert.ok(bounds.ease >= 1.3);
});

test('isDue equal date', () => {
  const dueEq = { ease: 2.3, intervalDays: 0, due: '2025-03-10', streak: 0 };
  assert.equal(isDue(dueEq, '2025-03-10'), true);
});

test('recognizers do not throw on empty', () => {
  assert.doesNotThrow(() => recognize('More', []));
  assert.doesNotThrow(() => recognize('I Love You', [{ keypoints: [] }]));
  const r1 = recognize('More', []);
  const r2 = recognize('I Love You', [{ keypoints: [] }]);
  assert.equal(r1, null);
  assert.ok(r2 === null || typeof r2 === 'object');
});

test('interval increases over wins', () => {
  let sim = { ease: 2.3, intervalDays: 0, due: start, streak: 0 };
  const i1 = scheduleSim(sim, true, start).intervalDays;
  sim = scheduleSim(sim, true, start);
  const i2 = scheduleSim(sim, true, start).intervalDays;
  assert.ok(i2 >= i1);
});
