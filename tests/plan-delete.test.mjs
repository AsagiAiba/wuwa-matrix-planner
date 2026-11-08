import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanLibrary, addPlan, activatePlan, deletePlan } from '../plan-library.js';

function threePlans() {
  let library = createPlanLibrary({ teams: [{ id: 'a-team', score: 100 }], marker: 1 }, 'A方案', 'a');
  library = addPlan(library, 'B方案', { teams: [{ id: 'b-team', score: 200 }], marker: 2 }, 'b');
  library = addPlan(library, 'C方案', { teams: [{ id: 'c-team', score: 300 }], marker: 3 }, 'c');
  return activatePlan(library, 'b');
}

function frozen(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(frozen);
  }
  return value;
}

test('deleting a non-active plan keeps the active ID and every remaining configuration intact', () => {
  const original = frozen(threePlans());
  const deleted = deletePlan(original, 'a');
  assert.deepEqual(deleted.plans.map(plan => plan.id), ['b', 'c']);
  assert.equal(deleted.activePlanId, 'b');
  assert.deepEqual(deleted.plans, original.plans.slice(1));
  deleted.plans[0].config.teams[0].score = 999;
  assert.equal(original.plans[1].config.teams[0].score, 200);
  assert.equal(deleted.plans[1].config.teams[0].score, 300);
});

test('deleting the active plan selects the next neighbor before considering the previous one', () => {
  const original = frozen(threePlans());
  const deleted = deletePlan(original, 'b');
  assert.equal(deleted.activePlanId, 'c');
  assert.deepEqual(deleted.plans, [original.plans[0], original.plans[2]]);
  assert.equal(original.activePlanId, 'b');
});

test('deleting the last-position active plan selects the previous neighbor', () => {
  const original = frozen(activatePlan(threePlans(), 'c'));
  const deleted = deletePlan(original, 'c');
  assert.equal(deleted.activePlanId, 'b');
  assert.deepEqual(deleted.plans.map(plan => plan.id), ['a', 'b']);
});

test('deleting the only plan needs an explicit fallback and assigns a new isolated ID', () => {
  const original = frozen(createPlanLibrary({ teams: [{ id: 'old', score: 400 }] }, '待删方案', 'old'));
  assert.throws(() => deletePlan(original, 'old'), /空白配置/);
  const fallback = { teams: [], marker: null, season: 'S2-3' };
  const deleted = deletePlan(original, 'old', fallback, undefined, 'blank');
  assert.equal(deleted.activePlanId, 'blank');
  assert.equal(deleted.plans[0].name, '空白排布');
  assert.deepEqual(deleted.plans[0].config, fallback);
  fallback.teams.push({ id: 'outside' });
  assert.deepEqual(deleted.plans[0].config.teams, []);
  deleted.plans[0].config.marker = 99;
  assert.deepEqual(original.plans[0].config.teams, [{ id: 'old', score: 400 }]);
  const automatic = deletePlan(original, 'old', { teams: [] });
  assert.notEqual(automatic.activePlanId, 'old');
});

test('invalid IDs and reuse of the deleted ID reject without mutating input', () => {
  const original = threePlans();
  const before = structuredClone(original);
  for (const id of ['missing', '', '   ', null]) assert.throws(() => deletePlan(original, id));
  assert.deepEqual(original, before);
  const only = createPlanLibrary({ teams: [] }, '唯一方案', 'only');
  assert.throws(() => deletePlan(only, 'only', { teams: [] }, '空白排布', 'only'), /不能复用/);
  assert.equal(only.plans.length, 1);
  assert.equal(only.activePlanId, 'only');
  assert.throws(() => deletePlan(only, 'only', null), /配置/);
});
