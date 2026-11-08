import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePlanLibrary, createPlanLibrary, addPlan, copyPlan, renamePlan, updatePlan, activatePlan } from '../plan-library.js';
import { characterIdentity, validateConfig } from '../score-axis.js';

const readJson = file => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const example = readJson('../config/demo.json');
const records = readJson('../data/scores.json').records;
const rules = readJson('../config/stamina.json');
const characters = readJson('../data/characters.json').entries.filter(character => !character.download_failed);
const characterIds = new Set(characters.map(character => character.id));
const identities = new Map(characters.map(character => [character.id, characterIdentity(character)]));
const validate = config => validateConfig(config, characterIds, records, identities, rules, { allowStaminaConflicts: true });

function frozen(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(frozen);
  }
  return value;
}

function twoPlans() {
  return addPlan(createPlanLibrary(example, '原方案', 'original'), '第二套', example, 'second');
}

test('a legacy single configuration becomes one plan without losing its contents', () => {
  const original = frozen(structuredClone(example));
  const library = createPlanLibrary(original, undefined, 'main');
  assert.equal(library.version, 1);
  assert.equal(library.activePlanId, 'main');
  assert.equal(library.plans[0].name, '我的排布');
  assert.deepEqual(library.plans[0].config, original);
  library.plans[0].config.teams[0].score = 12345;
  assert.equal(original.teams[0].score, example.teams[0].score);
});

test('copy preserves teams, unscored flags, markers, stamina version and view settings independently', () => {
  const original = structuredClone(example);
  original.teams[0].score = 0;
  original.teams[0].needsScore = true;
  original.scoreMarker = 125000;
  original.staminaSeason = 's2-phase4';
  original.maxRound = 4;
  const source = frozen(createPlanLibrary(original, '待填方案', 'source'));
  const copied = copyPlan(source, 'source', '副本', 'copy');
  assert.equal(copied.activePlanId, 'copy');
  assert.deepEqual(copied.plans[1].config, source.plans[0].config);
  copied.plans[1].config.teams[0].characterIds[0] = '1404';
  copied.plans[1].config.teams[0].needsScore = false;
  copied.plans[1].config.scoreMarker = 0;
  copied.plans[1].config.staminaSeason = 's2-phase3';
  assert.equal(copied.plans[0].config.teams[0].needsScore, true);
  assert.equal(copied.plans[0].config.teams[0].characterIds[0], original.teams[0].characterIds[0]);
  assert.equal(copied.plans[0].config.scoreMarker, 125000);
  assert.equal(copied.plans[0].config.staminaSeason, 's2-phase4');
  assert.deepEqual(source.plans[0].config, original);
});

test('normalization validates each plan independently instead of accumulating stamina across plans', () => {
  const strictValidate = config => validateConfig(config, characterIds, records, identities, rules);
  const library = twoPlans();
  const checked = normalizePlanLibrary(frozen(library), strictValidate);
  assert.deepEqual(checked.plans[0].config.teams, checked.plans[1].config.teams);
  assert.equal(checked.plans[0].config.teams[0].id, checked.plans[1].config.teams[0].id);
  checked.plans[1].config.teams[0].score = 1;
  assert.equal(checked.plans[0].config.teams[0].score, example.teams[0].score);
});

test('configuration validation receives a copy and cannot mutate library input or share its result', () => {
  const source = frozen(createPlanLibrary(example, '保存排布', 'source'));
  const shared = structuredClone(example);
  const checked = normalizePlanLibrary(source, config => {
    config.teams[0].name = 'callback local mutation';
    return shared;
  });
  assert.equal(source.plans[0].config.teams[0].name, example.teams[0].name);
  shared.teams[0].score = 100;
  assert.equal(checked.plans[0].config.teams[0].score, example.teams[0].score);
  const failure = createPlanLibrary(example, '无效分数', 'bad');
  failure.plans[0].config.teams[0].score = -1;
  assert.throws(() => normalizePlanLibrary(failure, validate), /分数/);
});

test('renaming and switching leave every saved configuration intact and isolated', () => {
  const initial = frozen(twoPlans());
  const renamed = renamePlan(initial, 'original', '  改名方案  ');
  assert.equal(renamed.plans[0].name, '改名方案');
  assert.equal(renamed.plans[1].name, initial.plans[1].name);
  assert.equal(renamed.activePlanId, 'second');
  assert.deepEqual(renamed.plans.map(plan => plan.config), initial.plans.map(plan => plan.config));
  const activated = activatePlan(initial, 'original');
  assert.equal(activated.activePlanId, 'original');
  activated.plans[0].config.teams[0].score = 321;
  assert.equal(initial.plans[0].config.teams[0].score, example.teams[0].score);
  assert.equal(activated.plans[1].config.teams[0].score, example.teams[0].score);
});

test('updating one plan does not change another plan or retain references to editable state', () => {
  const initial = frozen(twoPlans());
  const editable = structuredClone(example);
  editable.teams = editable.teams.slice().reverse();
  editable.teams[0].score = 1234;
  editable.scoreMarker = 15000;
  const updated = updatePlan(initial, 'second', editable);
  assert.deepEqual(updated.plans[0], initial.plans[0]);
  assert.deepEqual(updated.plans[1].config, editable);
  assert.equal(updated.activePlanId, initial.activePlanId);
  editable.teams[0].characterIds.push('1202');
  assert.equal(updated.plans[1].config.teams[0].characterIds.length, 3);
  assert.deepEqual(initial.plans[1].config, example);
});

test('library and plan fields reject malformed names, IDs, versions, or missing active plans', () => {
  const valid = createPlanLibrary(example, '名称', 'main');
  for (const bad of [null, [], { ...valid, version: 2 }, { ...valid, plans: [] }, { ...valid, activePlanId: 'missing' }]) {
    assert.throws(() => normalizePlanLibrary(bad, validate));
  }
  for (const name of ['', '  ', '字'.repeat(41), null]) {
    assert.throws(() => createPlanLibrary(example, name, 'id'), /名称/);
    assert.throws(() => renamePlan(valid, 'main', name), /名称/);
  }
  for (const id of ['', '  ', null]) assert.throws(() => createPlanLibrary(example, '名称', id), /ID/);
  assert.throws(() => addPlan(valid, '重复', example, 'main'), /唯一/);
  assert.throws(() => normalizePlanLibrary({ ...valid, plans: [valid.plans[0], { ...valid.plans[0], id: ' main ' }] }, validate), /唯一/);
  assert.throws(() => createPlanLibrary(null), /配置/);
  assert.throws(() => copyPlan(valid, 'missing', '副本'), /找不到/);
  assert.throws(() => updatePlan(valid, 'missing', example), /找不到/);
  assert.throws(() => activatePlan(valid, 'missing'), /找不到/);
});

test('the hundred-plan limit blocks additions and copies while still permitting edits', () => {
  const full = {
    version: 1, activePlanId: 'plan-0',
    plans: Array.from({ length: 100 }, (_, index) => ({ id: `plan-${index}`, name: `排布${index}`, config: structuredClone(example) })),
  };
  const before = structuredClone(full);
  assert.equal(normalizePlanLibrary(frozen(full), validate).plans.length, 100);
  assert.throws(() => addPlan(full, '第101套', example, 'overflow'), /100/);
  assert.throws(() => copyPlan(full, 'plan-0', '副本', 'overflow'), /100/);
  assert.equal(renamePlan(full, 'plan-0', '仍能改名').plans[0].name, '仍能改名');
  assert.deepEqual(full, before);
});
