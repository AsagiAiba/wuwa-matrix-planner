import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seasonDefinitions, getSeason, seasonStaminaRules, buildSeasonScores } from '../season-config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = relative => JSON.parse(readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8'));
const source = readJson('data/scores.json');

test('registry supplies concrete identities and legacy tower-ID lookup without period mismatch', () => {
  assert.equal(seasonDefinitions.length, 2);
  assert.equal(getSeason().id, 's2-phase3');
  for (const [id, towerId, stage] of [['s2-phase3', 16, 3], ['s2-phase4', 18, 4]]) {
    const season = getSeason(id);
    assert.equal(season.stage, stage);
    assert.equal(season.towerId, towerId);
    assert.equal(season.modeName, '奇点扩张');
    assert.equal(season.maxRound, 15);
    assert.equal(getSeason({ towerId }).id, id);
    assert.equal(getSeason({ matrixSeason: id, towerId }).id, id);
  }
  assert.throws(() => getSeason('unknown'), /找不到/);
  assert.throws(() => getSeason({}), /不匹配/);
  assert.throws(() => getSeason({ matrixSeason: 's2-phase3', towerId: 18 }), /不匹配/);
});

test('both 75-wave score schedules preserve corresponding S2-3 points and recompute cumulative totals', () => {
  const original = buildSeasonScores('s2-phase3');
  const provisional = buildSeasonScores('s2-phase4');
  assert.equal(original.records.length, 75);
  assert.equal(provisional.records.length, 75);
  let cumulative = 0;
  for (let index = 0; index < 75; index++) {
    const wave = original.records[index], borrowed = provisional.records[index];
    assert.equal(wave.full_kill_points, source.records[index].full_kill_points);
    assert.equal(wave.kill_bonus, source.records[index].kill_bonus);
    assert.equal(borrowed.full_kill_points, wave.full_kill_points);
    assert.equal(borrowed.kill_bonus, wave.kill_bonus);
    assert.equal(wave.cumulative_points_before, cumulative);
    assert.equal(borrowed.cumulative_points_before, cumulative);
    cumulative += wave.full_kill_points;
    assert.equal(wave.cumulative_points_after, cumulative);
    assert.equal(borrowed.cumulative_points_after, cumulative);
    assert.equal(wave.provisional, false);
    assert.equal(borrowed.provisional, true);
    assert.equal(borrowed.score_reference_season, 's2-phase3');
    assert.equal(borrowed.source_cell, null);
  }
  assert.equal(original.records.filter(wave => wave.estimated).length, 33);
  assert.equal(provisional.records.filter(wave => wave.estimated).length, 33);
  assert.match(provisional.basis, /暂按S2-3相同出场位次沿用.*尚未实测/);
});

test('S2-4 repeats the exact published boss order and all configured assets exist locally', () => {
  const names = ['飞廉之猩', '达妮娅', '无冠者', '辛吉勒姆', '矩阵奇藏'];
  const ids = ['607750002', '665700003', '650000041', '676750008', '401800000'];
  const season = getSeason('s2-phase4');
  assert.deepEqual(season.bosses.map(boss => boss.name), names);
  assert.deepEqual(season.bosses.map(boss => boss.id), ids);
  assert.equal(season.source, 'https://ww.nanoka.cc/newtower/18');
  const built = buildSeasonScores(season);
  for (let index = 0; index < 75; index++) assert.equal(built.records[index].name, names[index % 5]);
  for (const definition of seasonDefinitions) {
    for (const resource of [...definition.bosses, ...definition.circuits, ...definition.characters]) {
      assert.ok(existsSync(path.join(root, resource.icon_file)), resource.icon_file);
    }
  }
});

test('each JSON controls its own stamina bonus and matrix enhancements', () => {
  const phase3 = getSeason('s2-phase3'), phase4 = getSeason('s2-phase4');
  const rules = seasonStaminaRules();
  assert.deepEqual(rules.seasons[0].bonusCharacterIds, ['1509']);
  assert.deepEqual(rules.seasons[1].bonusCharacterIds, ['1109']);
  assert.equal(Object.keys(phase3.stamina.baseStamina).length, 6);
  assert.equal(phase3.stamina.baseStamina['1110'], 2);
  assert.deepEqual(phase3.stamina.baseStamina, phase4.stamina.baseStamina);
  assert.equal(phase3.circuits.length, 4); assert.equal(phase4.circuits.length, 4);
  assert.equal(phase3.characters.length, 13); assert.equal(phase4.characters.length, 13);
  assert.notDeepEqual(phase3.circuits.map(circuit => circuit.description), phase4.circuits.map(circuit => circuit.description));
  for (const [definition, id, name] of [[phase3, '1509', '琳奈'], [phase4, '1109', '洛瑟菈']]) {
    const staminaCharacters = definition.characters.filter(character => character.enhancements.some(effect => effect.kind === 'stamina-bonus'));
    assert.deepEqual(staminaCharacters.map(character => character.id), [id]);
    assert.equal(staminaCharacters[0].name, name);
    const effect = staminaCharacters[0].enhancements.find(effect => effect.kind === 'stamina-bonus');
    assert.match(effect.description, /额外1点体力/);
    assert.ok(effect.description.includes(definition.name));
  }
  assert.ok(!phase3.characters.some(character => character.id === '1109'));
  rules.seasons[0].baseStamina['1110'] = 99;
  assert.equal(getSeason('s2-phase3').stamina.baseStamina['1110'], 2);
});

test('definitions are deeply frozen and generated records are independent mutable copies', () => {
  assert.ok(Object.isFrozen(seasonDefinitions));
  const definition = getSeason('s2-phase3');
  assert.ok(Object.isFrozen(definition.scoring.waves[0]));
  assert.throws(() => { definition.scoring.waves[0].fullPoints = 7; }, TypeError);
  const built = buildSeasonScores('s2-phase3');
  built.records[0].full_kill_points = 7;
  built.records[0].name = '修改副本';
  assert.equal(buildSeasonScores('s2-phase3').records[0].full_kill_points, source.records[0].full_kill_points);
  assert.equal(getSeason('s2-phase3').bosses[0].name, '燎照之骑');
});

test('physical HP provenance is independent of score provenance and S2-4 explicitly borrows same-position HP as provisional', () => {
  const phase3 = buildSeasonScores('s2-phase3').records;
  assert.equal(phase3[0].max_hp, 5612519);
  assert.equal(phase3[4].max_hp, 6173771);
  assert.equal(phase3[5].max_hp, 9541514);
  assert.equal(phase3[9].max_hp, 12756094);
  assert.equal(phase3[10].max_hp, 19388951);
  assert.ok(phase3.slice(0, 15).every(wave => wave.hp_status === 'source'));
  assert.ok(phase3.slice(15).every(wave => wave.hp_status === 'inferred'));
  assert.equal(phase3[15].estimated, false);
  assert.equal(phase3[15].max_hp, 19388951 * 1.05);
  const phase4 = buildSeasonScores('s2-phase4').records;
  for (let index = 0; index < phase3.length; index++) {
    assert.equal(phase4[index].round, phase3[index].round);
    assert.equal(phase4[index].boss_position, phase3[index].boss_position);
    assert.equal(phase4[index].max_hp, phase3[index].max_hp);
    assert.equal(phase4[index].hp_status, 'provisional');
  }
  assert.match(getSeason('s2-phase4').scoring.hpBasis, /暂按 S2-3 相同轮次、相同出场位次/);
});

test('matrix resistances use the confirmed 20% base and 40% tagged attribute, with uniform chest resistance', () => {
  const expected = { '燎照之骑': 2, '封庭械囿': 1, '无冠者': 6, '天傀劫煞': 4, '飞廉之猩': 4, '达妮娅': 2, '辛吉勒姆': 5, '矩阵奇藏': null };
  for (const season of seasonDefinitions) {
    for (const boss of season.bosses) {
      assert.equal(boss.resistances.status, 'confirmed');
      assert.equal(boss.resistances.highElement, expected[boss.name]);
      for (let id = 1; id <= 6; id++) assert.equal(boss.resistances.values[id], id === expected[boss.name] ? 40 : 20);
    }
  }
});

function runChangedConfig(change) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'matrix-season-config-'));
  try {
    mkdirSync(path.join(temporaryRoot, 'config', 'seasons'), { recursive: true });
    copyFileSync(path.join(root, 'season-config.js'), path.join(temporaryRoot, 'season-config.js'));
    writeFileSync(path.join(temporaryRoot, 'package.json'), '{"type":"module"}');
    const registry = readJson('config/seasons.json');
    const phase3 = readJson('config/seasons/s2-3.json'), phase4 = readJson('config/seasons/s2-4.json');
    change({ registry, phase3, phase4 });
    for (const [filename, value] of [['config/seasons.json', registry], ['config/seasons/s2-3.json', phase3], ['config/seasons/s2-4.json', phase4]]) writeFileSync(path.join(temporaryRoot, filename), JSON.stringify(value));
    const moduleUrl = pathToFileURL(path.join(temporaryRoot, 'season-config.js')).href;
    return spawnSync(process.execPath, ['--input-type=module', '-e', `const {buildSeasonScores}=await import(${JSON.stringify(moduleUrl)});console.log(JSON.stringify(buildSeasonScores('s2-phase4').records.slice(0,2)))`], { encoding: 'utf8' });
  } finally {
    const resolvedRoot = path.resolve(temporaryRoot), intendedRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolvedRoot.startsWith(intendedRoot) && path.basename(resolvedRoot).startsWith('matrix-season-config-'));
    rmSync(resolvedRoot, { recursive: true, force: true });
  }
}

test('editing JSON points changes scores and prefixes without relying on obsolete cumulative fields', () => {
  const result = runChangedConfig(({ phase4 }) => {
    phase4.scoring.waves[0].fullPoints += 123.5;
    phase4.scoring.waves[0].cumulative_points_after = 999999999;
  });
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  assert.equal(rows[0].full_kill_points, source.records[0].full_kill_points + 123.5);
  assert.equal(rows[0].cumulative_points_before, 0);
  assert.equal(rows[1].cumulative_points_before, rows[0].full_kill_points);
});

test('unsafe registry paths and invalid boss/wave values fail before use', () => {
  for (const change of [
    ({ registry }) => { registry.seasons[0].file = '../private.json'; },
    ({ phase4 }) => { phase4.bosses[0].order = 2; },
    ({ phase4 }) => { phase4.bosses[0].icon_file = '../private.webp'; },
    ({ phase4 }) => { phase4.scoring.waves.pop(); },
    ({ phase4 }) => { phase4.scoring.waves[0].fullPoints = phase4.scoring.waves[0].killBonus; },
    ({ phase4 }) => { phase4.scoring.waves[0].maxHp = null; },
    ({ phase4 }) => { phase4.scoring.waves[0].maxHp = 0; },
    ({ phase4 }) => { phase4.scoring.waves[0].hpStatus = 'unconfirmed'; },
    ({ phase4 }) => { phase4.bosses[0].resistances.status = 'confirmed'; phase4.bosses[0].resistances.values['1'] = null; },
    ({ phase4 }) => { phase4.bosses[0].resistances.values['2'] = '40'; },
  ]) {
    const result = runChangedConfig(change);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /赛季配置无效/);
  }
});
