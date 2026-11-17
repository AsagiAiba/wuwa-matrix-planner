import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const catalog = read('config/boss_properties.json');
const sources = read('data/boss_property_sources.json');
const phase = id => catalog.seasons.find(season => season.id === id);

test('all matrix stages use the confirmed S0 mapping and contain only matrix roster entries', () => {
  assert.equal(sources.towers.length, 18);
  assert.equal(catalog.seasons.length, 9);
  assert.equal(new Set(catalog.seasons.map(season => season.id)).size, 9);
  assert.deepEqual(catalog.seasons.map(season => season.label), ['S0-1','S0-2','S1-1','S1-2','S1-3','S2-1','S2-2','S2-3','S2-4']);
  assert.deepEqual(catalog.seasons.slice(0,3).map(season => season.towerId), [2,4,6]);
  assert.ok(catalog.seasons.slice(0,2).every(season => season.activityName === '矩阵叠兵' && season.namingSource === '用户自定义赛季名'));
  assert.equal(read('config/seasons.json').seasons.length, 2, 'property references must not invent score/stamina seasons');
  for (const season of catalog.seasons) {
    const source = sources.towers.find(tower => tower.towerId === season.towerId);
    assert.equal(source.mode, '奇点扩张');
    for (const boss of season.bosses) assert.ok(source.waves.some(wave => wave.monsterId === boss.id && wave.name === boss.name), `${boss.name} must actually occur in this matrix stage`);
  }
});

test('Nanoka excerpts are traceable to the same tower, monster and wave, with real local portraits', () => {
  let confirmed = 0;
  for (const season of catalog.seasons) for (const boss of season.bosses) {
    if (!boss.specialProperties.length) { assert.equal(boss.status, 'pending'); continue; }
    confirmed++;
    assert.equal(boss.status, 'confirmed');
    assert.ok(existsSync(new URL(`../${boss.icon_file}`, import.meta.url)));
    assert.ok(boss.specialProperties.every(text => !/无敌|免疫所有伤害|共振度削减|每5秒提升3%攻击/.test(text)));
    if (boss.propertySource !== 'nanoka') continue;
    const source = sources.towers.find(tower => tower.towerId === season.towerId);
    assert.equal(boss.propertyEvidence.length, boss.specialProperties.length);
    for (const evidence of boss.propertyEvidence) {
      assert.ok(evidence.waveIds.length > 0);
      for (const id of evidence.waveIds) {
        const wave = source.waves.find(entry => entry.id === id);
        assert.equal(wave.monsterId, boss.id);
        assert.ok(wave.description.includes(evidence.description));
      }
    }
  }
  assert.equal(confirmed, 24);
});

test('missing mechanics remain blank and the confirmed Cingulum correction applies consistently', () => {
  assert.deepEqual(phase('s0-phase2').bosses.find(boss => boss.name === '飞廉之猩').specialProperties, phase('s2-phase4').bosses.find(boss => boss.name === '飞廉之猩').specialProperties);
  assert.deepEqual(phase('s2-phase2').bosses.find(boss => boss.name === '哀声鸷').specialProperties, []);
  const cingulum = phase('s2-phase4').bosses.find(boss => boss.name === '辛吉勒姆').specialProperties;
  assert.match(cingulum.join(''), /伤害最终降低25%.*迷航/);
  for (const id of ['s1-phase1','s1-phase3']) assert.deepEqual(phase(id).bosses.find(boss => boss.name === '辛吉勒姆').specialProperties, cingulum);
});

test('every occurrence of the same matrix Boss shares one synchronized property list', () => {
  const properties = new Map();
  for (const period of catalog.seasons) for (const boss of period.bosses) {
    const key = boss.propertyGroup || boss.name;
    if (properties.has(key)) assert.deepEqual(boss.specialProperties, properties.get(key));
    properties.set(key, boss.specialProperties);
  }
  assert.equal(properties.size, 22);
});

test('user corrections replace furnace text and keep each cluster lineup separate', () => {
  const corrections = read('config/boss_property_overrides.json');
  for (const period of catalog.seasons) for (const boss of period.bosses) {
    if (corrections.bosses[boss.name]) assert.deepEqual(boss.specialProperties, corrections.bosses[boss.name].specialProperties);
    if (boss.name === '炉芯机骸') {
      assert.equal(boss.specialProperties.length, 1);
      assert.doesNotMatch(boss.specialProperties[0], /炽能斩|经历数次逆势回击/);
      assert.match(boss.specialProperties[0], /100%.*30秒/);
    }
    if (boss.name !== '矩阵集群') continue;
    const expected = corrections.clusters[period.id];
    assert.equal(boss.representativeName, expected.representativeName);
    assert.equal(boss.propertyGroup, expected.propertyGroup);
    assert.deepEqual(boss.specialProperties, expected.specialProperties);
    assert.ok(existsSync(new URL(`../${boss.icon_file}`, import.meta.url)));
  }
  assert.match(phase('s2-phase2').bosses.find(boss => boss.name === '朔雷之鳞').specialProperties.join(''), /20%.*上限提升2层.*附加的2层.*仅可触发1次/);
  assert.equal(phase('s1-phase3').bosses.find(boss => boss.name === '矩阵集群').specialProperties.length, 0);
  const clusterText = phase('s2-phase1').bosses.find(boss => boss.name === '矩阵集群').specialProperties.join('');
  assert.equal(clusterText, '敌方所受到的湮灭伤害最终提升10%，当受虚湮效应影响时，该效果提升至40%。');
  assert.doesNotMatch(clusterText, /消耗|攻击力提升50%/);
});

test('monster-description additions retain their damage trigger context and verified source text', () => {
  for (const season of catalog.seasons) for (const boss of season.bosses) for (const reference of boss.monsterSources || []) {
    const detail = sources.monsters.find(monster => monster.id === reference.monsterId);
    assert.equal(detail.name, boss.name);
    assert.equal(detail.source, reference.source);
    for (const text of reference.descriptions) assert.ok(detail.description.includes(text));
  }
  const explorer = phase('s1-phase1').bosses.find(boss => boss.name === '无铭探索者');
  assert.equal(explorer.specialProperties.length, 3);
  assert.match(explorer.specialProperties.join(''), /上限增加2层.*额外附加1层.*提升4%/);
  const hyvatia = phase('s0-phase2').bosses.find(boss => boss.name === '海维夏').specialProperties.join('');
  assert.match(hyvatia, /100%.*震谐·偏移.*15%.*15秒/);
  assert.doesNotMatch(hyvatia, /无法被闪避/);
});

test('all nine period references contain resolved circuit text and icons but no score or stamina rules', () => {
  const references = read('config/matrix_references.json');
  assert.deepEqual(references.periods.map(period => period.id), catalog.seasons.map(season => season.id));
  assert.equal(references.periods.reduce((n, period) => n + period.circuits.length, 0), 36);
  for (const period of references.periods) {
    assert.equal(period.viewOnly, !['s2-phase3','s2-phase4'].includes(period.id));
    for (const key of ['scoring','maxRound','stamina','teams']) assert.ok(!(key in period));
    for (const circuit of period.circuits) {
      const expected = circuit.sourceDescription.replace(/\{(\d+)\}/g, (_, index) => circuit.sourceParameters[index]).replace(/<\/?color(?:=[^>]*)?>/gi, '').trim();
      assert.equal(circuit.description, expected);
      assert.doesNotMatch(circuit.description, /\{\d+\}/);
      assert.ok(existsSync(new URL(`../${circuit.icon_file}`, import.meta.url)));
    }
  }
});

test('manual current-season properties and shield-triggered damage amplification are preserved exactly', () => {
  for (const file of ['s2-3','s2-4']) {
    const playable = read(`config/seasons/${file}.json`);
    for (const boss of playable.bosses) assert.deepEqual(phase(playable.id).bosses.find(entry => entry.id === boss.id).specialProperties, boss.specialProperties);
  }
  assert.match(phase('s2-phase3').bosses.find(boss => boss.name === '封庭械囿').specialProperties[0], /获得护盾.*最终伤害提升10%/);
});
