import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visibleWaves, bossScoreAtRemainingHp, locateScore, packTeams, reorderTeams, nearestTeamSlot, characterIdentity, validateConfig, staminaLimits, MIN_ZOOM, defaultTeamName, splitQuickTeams, axisTickStep } from '../score-axis.js';
const scores = JSON.parse(readFileSync(new URL('../data/scores.json', import.meta.url))).records;
const example = JSON.parse(readFileSync(new URL('../config/demo.json', import.meta.url)));
const characters = new Set(JSON.parse(readFileSync(new URL('../data/characters.json', import.meta.url))).entries.filter(item => !item.download_failed).map(item => item.id));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const stamina = JSON.parse(readFileSync(new URL('../config/stamina.json', import.meta.url)));

test('remaining HP calculator keeps earned and remaining scores complementary at endpoints and fractional HP', () => {
  for (const wave of scores) {
    assert.deepEqual(bossScoreAtRemainingHp(wave, 100), {
      earnedPoints: 0, remainingPoints: wave.full_kill_points, damagePointsEarned: 0, killBonusEarned: 0,
    });
    assert.deepEqual(bossScoreAtRemainingHp(wave, 0), {
      earnedPoints: wave.full_kill_points, remainingPoints: 0, damagePointsEarned: wave.damage_points_at_full_hp, killBonusEarned: wave.kill_bonus,
    });
    const fractional = bossScoreAtRemainingHp(wave, 37.25);
    near(fractional.earnedPoints, wave.damage_points_at_full_hp * .6275);
    near(fractional.remainingPoints, wave.damage_points_at_full_hp * .3725 + wave.kill_bonus);
    near(fractional.earnedPoints + fractional.remainingPoints, wave.full_kill_points);
    assert.equal(fractional.killBonusEarned, 0);
  }
});
test('remaining HP calculator awards the chest bonus only on reaching zero HP', () => {
  for (const wave of scores.filter(item => item.kill_bonus)) {
    const alive = bossScoreAtRemainingHp(wave, .001);
    assert.equal(alive.killBonusEarned, 0);
    assert.ok(alive.remainingPoints > wave.kill_bonus);
    const defeated = bossScoreAtRemainingHp(wave, 0);
    assert.equal(defeated.killBonusEarned, wave.kill_bonus);
    near(defeated.earnedPoints - defeated.damagePointsEarned, wave.kill_bonus);
  }
});
test('remaining HP calculator rejects missing, nonnumeric and out-of-range input', () => {
  for (const invalid of ['', '50', 'bad', null, undefined, true, NaN, Infinity, -Infinity, -.01, 100.01]) {
    assert.throws(() => bossScoreAtRemainingHp(scores[0], invalid), /百分比/);
  }
  assert.throws(() => bossScoreAtRemainingHp(null, 50), /分数数据/);
  assert.throws(() => bossScoreAtRemainingHp({ ...scores[0], damage_points_at_full_hp: NaN }, 50), /分数数据/);
});

test('all 75 boss midpoints map to 50% HP', () => {
  for (const wave of scores) {
    const found = locateScore(wave.cumulative_points_before + wave.damage_points_at_full_hp / 2, scores);
    assert.equal(found.wave.wave_index, wave.wave_index);
    near(found.remainingHp, .5);
    assert.equal(found.inBonus, false);
  }
});
test('exact boss boundaries select the next full-HP boss', () => {
  for (let i = 0; i < scores.length - 1; i++) {
    const found = locateScore(scores[i].cumulative_points_after, scores);
    assert.equal(found.wave.wave_index, scores[i + 1].wave_index);
    near(found.remainingHp, 1);
  }
  assert.equal(locateScore(scores.at(-1).cumulative_points_after, scores).completed, true);
});
test('chest bonus is a discrete reward region, never fractional HP', () => {
  for (const wave of scores.filter(item => item.kill_bonus)) {
    for (const extra of [0, 100, 999]) {
      const point = locateScore(wave.cumulative_points_before + wave.damage_points_at_full_hp + extra, scores);
      assert.equal(point.inBonus, true);
      assert.equal(point.remainingHp, 0);
    }
  }
});
test('packing pins the first team to zero and joins endpoints after edits and deletes', () => {
  const changed = structuredClone(example.teams);
  changed[0].score = 1234.56;
  changed[0].startScore = 10000;
  const packed = packTeams(changed);
  assert.equal(packed[0].startScore, 0);
  near(packed[1].startScore, 1234.56);
  near(packed[2].startScore, 1234.56 + packed[1].score);
  const deleted = packTeams(packed.filter(team => team.id !== 'team-2'));
  near(deleted[1].startScore, 1234.56);
});
test('dragging snaps to slots and reorders without gaps or score changes', () => {
  assert.equal(nearestTeamSlot(example.teams, 'team-1', 100), 0);
  assert.equal(nearestTeamSlot(example.teams, 'team-1', 7000), 1);
  const reordered = reorderTeams(example.teams, 'team-1', 1);
  assert.deepEqual(reordered.map(team => team.id), ['team-2', 'team-1', 'team-3']);
  assert.equal(reordered[0].startScore, 0);
  assert.equal(reordered[1].startScore, reordered[0].score);
  assert.equal(reordered[2].startScore, reordered[0].score + reordered[1].score);
  assert.equal(reordered[1].score, 8000);
});
test('source rows are preserved and R9-R15 extensions are explicitly marked', () => {
  const source = JSON.parse(readFileSync(new URL('../data/scores_source.json', import.meta.url))).records;
  assert.deepEqual(scores.slice(0, 42), source);
  const round9 = visibleWaves(scores, 9).filter(item => item.round === 9);
  assert.equal(round9.length, 5);
  assert.equal(round9.filter(item => item.estimated).length, 3);
  assert.equal(scores.length, 75);
  assert.throws(() => locateScore(-1, scores), RangeError);
  assert.throws(() => locateScore(Infinity, scores), RangeError);
});
test('JSON round trip preserves teams, avatars, scores and positions', () => {
  assert.deepEqual(validateConfig(JSON.parse(JSON.stringify(example)), characters, scores), example);
  const bad = structuredClone(example);
  bad.teams[0].characterIds[1] = bad.teams[0].characterIds[0];
  assert.throws(() => validateConfig(bad, characters, scores), /3 个不同/);
  const overflow = structuredClone(example);
  overflow.teams[0].startScore = 1e9;
  assert.throws(() => validateConfig(overflow, characters, scores), /超出/);
  const other = structuredClone(example); other.towerId = 18;
  assert.throws(() => validateConfig(other, characters, scores), /不匹配/);
});
test('JSON prevents cross-team reuse, including other Rover variants', () => {
  const duplicate = structuredClone(example);
  duplicate.teams[1].characterIds[0] = duplicate.teams[0].characterIds[0];
  assert.throws(() => validateConfig(duplicate, characters, scores), /重复上阵/);
  const data = JSON.parse(readFileSync(new URL('../data/characters.json', import.meta.url))).entries;
  const identities = new Map(data.map(character => [character.id, characterIdentity(character)]));
  const rovers = data.filter(character => character.name.startsWith('漂泊者'));
  duplicate.teams[0].characterIds[0] = rovers[0].id;
  duplicate.teams[1].characterIds[0] = rovers[1].id;
  assert.throws(() => validateConfig(duplicate, characters, scores, identities), /重复上阵/);
  const legacy = structuredClone(example); legacy.teams[0].startScore = 2000;
  assert.equal(validateConfig(legacy, characters, scores).teams[0].startScore, 0);
});
test('all six configured two-stamina characters may enter two teams, but not three', () => {
  assert.equal(Object.keys(stamina.baseStamina).length, 6);
  assert.equal(stamina.baseStamina['1110'], 2);
  for (const id of Object.keys(stamina.baseStamina)) {
    const plan = structuredClone(example);
    plan.teams[0].characterIds[2] = id;
    plan.teams[1].characterIds[2] = id;
    plan.teams[2].characterIds[2] = '1507';
    assert.doesNotThrow(() => validateConfig(plan, characters, scores, new Map(), stamina));
    plan.teams[2].characterIds[2] = id;
    assert.throws(() => validateConfig(plan, characters, scores, new Map(), stamina), /体力不足/);
    plan.teams = packTeams(plan.teams.slice(1));
    assert.doesNotThrow(() => validateConfig(plan, characters, scores, new Map(), stamina));
  }
});
test('Lynae bonus is current-period only; Lucilla bonus is next-period only', () => {
  for (const [id, allowed, denied] of [['1509', 's2-phase3', 's2-phase4'], ['1109', 's2-phase4', 's2-phase3']]) {
    const plan = structuredClone(example);
    plan.teams[0].characterIds[2] = id;
    plan.teams[1].characterIds[2] = id;
    plan.staminaSeason = allowed;
    assert.doesNotThrow(() => validateConfig(plan, characters, scores, new Map(), stamina));
    plan.staminaSeason = denied;
    assert.throws(() => validateConfig(plan, characters, scores, new Map(), stamina), /体力不足/);
  }
  const stacked = structuredClone(stamina);
  stacked.seasons[0].bonusCharacterIds = ['1505'];
  assert.equal(staminaLimits(stacked, 's2-phase3').get('1505'), 3);
});
test('old zoom values migrate to the new minimum without losing a plan', () => {
  const plan = structuredClone(example); plan.pixelsPerPoint = MIN_ZOOM / 2;
  const updated = validateConfig(plan, characters, scores, new Map(), stamina);
  assert.equal(updated.pixelsPerPoint, MIN_ZOOM);
  assert.deepEqual(updated.teams, plan.teams);
});
test('remaining points follow each Boss score span, including unclaimed bonus', () => {
  for (const wave of scores) {
    const mid = locateScore(wave.cumulative_points_before + wave.damage_points_at_full_hp / 2, scores);
    near(mid.remainingPoints, wave.damage_points_at_full_hp / 2 + wave.kill_bonus);
  }
  const chest = scores[4];
  near(locateScore(chest.cumulative_points_after - 100, scores).remainingPoints, 100);
  assert.equal(locateScore(scores.at(-1).cumulative_points_after, scores).remainingPoints, 0);
});
test('score markers validate the full data range and expand displayed rounds', () => {
  const plan = structuredClone(example); plan.scoreMarker = 150000;
  assert.equal(validateConfig(plan, characters, scores).maxRound, 3);
  plan.scoreMarker = 0;
  assert.equal(validateConfig(plan, characters, scores).scoreMarker, 0);
  plan.scoreMarker = scores.at(-1).cumulative_points_after;
  assert.equal(validateConfig(plan, characters, scores).maxRound, 15);
  for (const value of [-1, Infinity, NaN, scores.at(-1).cumulative_points_after + 1]) {
    plan.scoreMarker = value;
    assert.throws(() => validateConfig(plan, characters, scores), /目标总分/);
  }
  plan.scoreMarker = null; plan.maxRound = 99;
  const limited = validateConfig(plan, characters, scores);
  assert.equal(limited.maxRound, 15);
  assert.deepEqual(limited.teams, plan.teams);
});
test('automatic names take each character first codepoint in selection order', () => {
  const map = new Map(JSON.parse(readFileSync(new URL('../data/characters.json', import.meta.url))).entries.map(entry => [entry.id, entry]));
  assert.equal(defaultTeamName(['1305', '1302', '1409'], map), '相吟卡');
  assert.equal(defaultTeamName(['1302', '1305'], map), '吟相');
  assert.equal(defaultTeamName([], map), '');
  for (const scale of [.0001, .001, .01, .04, .24]) assert.ok(axisTickStep(scale) * scale >= 80);
});
test('matrix identity is explicit and legacy stamina choices do not change the score-data period', () => {
  const legacy = structuredClone(example); delete legacy.matrixSeason; delete legacy.matrixVersion; legacy.staminaSeason = 's2-phase4';
  const migrated = validateConfig(legacy, characters, scores, new Map(), stamina);
  assert.equal(migrated.matrixSeason, 's2-phase3'); assert.equal(migrated.staminaSeason, 's2-phase4');
  const phase4 = { ...structuredClone(example), towerId: 18, matrixSeason: 's2-phase4', matrixVersion: 'wrong', staminaSeason: 's2-phase4', scoreMarker: 2000000 };
  const result = validateConfig(phase4, characters, scores, new Map(), stamina);
  assert.equal(result.matrixVersion, '终焉矩阵S2-4（S2第四阶段）'); assert.equal(result.scoreMarker, 2000000);
});
test('quick selections split strictly in threes and preserve partial last group', () => {
  assert.deepEqual(splitQuickTeams(['a', 'b', 'c', 'd', 'e', 'f', 'g']), [['a', 'b', 'c'], ['d', 'e', 'f'], ['g']]);
  assert.deepEqual(splitQuickTeams([]), []);
});
test('unscored quick teams preserve order without inventing points', () => {
  const plan = structuredClone(example);
  plan.teams.push({ id: 'quick-1', name: '忌鉴莫', nameMode: 'auto', characterIds: ['1404', '1405', '1204'], score: 0, needsScore: true, startScore: 24000, color: '#aabbcc' });
  const result = validateConfig(plan, characters, scores, new Map(), stamina);
  assert.deepEqual(result.teams.slice(0, 3), example.teams);
  assert.equal(result.teams[3].startScore, 24000);
  assert.equal(result.teams.reduce((sum, team) => sum + team.score, 0), 24000);
  delete plan.teams[3].needsScore;
  assert.throws(() => validateConfig(plan, characters, scores), /超出/);
});
