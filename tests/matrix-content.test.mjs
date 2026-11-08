import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const readJson = filename => JSON.parse(readFileSync(new URL(filename, import.meta.url), 'utf8'));
const phase3 = readJson('../data/matrix_content_16.json');
const phase4 = readJson('../data/matrix_content_18.json');
const characters = new Map(readJson('../data/characters.json').entries.map(character => [character.id, character]));

test('both phase files retain their own source URLs and exact version identity', () => {
  for (const [content, towerId, season, label] of [[phase3, 16, 's2-phase3', '终焉矩阵S2-3（S2第三阶段）'], [phase4, 18, 's2-phase4', '终焉矩阵S2-4（S2第四阶段）']]) {
    assert.equal(content.towerId, towerId);
    assert.equal(content.matrixSeason, season);
    assert.equal(content.matrixVersion, label);
    assert.equal(content.source, `https://ww.nanoka.cc/newtower/${towerId}`);
    assert.equal(content.dataSource, `https://static.nanoka.cc/ww/3.8.3/zh/newtower/${towerId}.json`);
    assert.equal(content.circuits.length, 4);
    assert.equal(content.characters.length, 13);
    assert.ok(Number.isFinite(Date.parse(content.capturedAtUtc)));
  }
});

test('parameter substitution preserves exact percentages, durations, and line breaks', () => {
  const circuits = new Map(phase3.circuits.map(circuit => [circuit.name, circuit.description]));
  assert.equal(circuits.get('通用强化'), '敌人受到伤害最终提升20%，敌人受到普攻伤害最终提升20%。');
  assert.equal(circuits.get('异常效应强化'), '角色附加异常效应时，使目标受到最终伤害提升25%，受到导电最终伤害额外提升30%，持续30秒。');
  assert.match(circuits.get('基础伤害强化'), /40%；\n.*55%.*30秒；\n.*11%.*5层.*2秒/s);
  assert.match(circuits.get('谐度破坏强化'), /谐度·偏移.*25%.*30秒。\n.*骇破·偏移.*30%.*30秒/s);
});

test('source-specific character buffs and the phase-4 fatigue restriction remain explicit', () => {
  for (const content of [phase3, phase4]) {
    for (const character of content.characters) {
      assert.equal(character.name, characters.get(character.id).name);
      assert.equal(character.icon_file, characters.get(character.id).icon_file);
      for (const enhancement of character.enhancements) {
        assert.ok(enhancement.sourceKey);
        assert.doesNotMatch(enhancement.description, /\{\d+\}|<[^>]+>/);
      }
    }
    assert.equal(content.characters.find(character => character.id === '1109').enhancements[0].description, '角色拥有额外疲劳值（限S2第4阶段）。');
    assert.equal(content.characters.find(character => character.id === '1302').enhancements[0].description, '角色最终伤害提升20%。施放共鸣解放时，队伍中的角色共鸣解放加成提升30%，持续30秒。');
    assert.ok(content.characters.every(character => character.enhancements.every(enhancement => !enhancement.description.includes('六命'))));
  }
});
test('each circuit uses a verified local copy of its published Nanoka icon', () => {
  for (const content of [phase3, phase4]) {
    for (const circuit of content.circuits) {
      const asset = readFileSync(new URL(`../${circuit.icon_file}`, import.meta.url));
      assert.equal(asset.toString('ascii', 0, 4), 'RIFF');
      assert.equal(asset.toString('ascii', 8, 12), 'WEBP');
      assert.equal(createHash('sha256').update(asset).digest('hex'), circuit.icon_sha256);
      assert.equal(asset.length, circuit.icon_bytes);
      assert.ok(circuit.icon_width > 0 && circuit.icon_height > 0);
      const imagePath = circuit.icon_source_path.replace('/Game/Aki/UI/', '').split('.')[0];
      assert.equal(circuit.icon_url, `https://static.nanoka.cc/assets/ww/${imagePath}.webp`);
    }
  }
});
