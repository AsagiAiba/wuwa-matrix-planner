"""Build the season-specific Boss damage-property catalog from public Nanoka data.

Only reviewed, exact source excerpts are accepted. Unknown descriptions stay pending.
Existing playable-season descriptions remain authoritative manual input.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import html
import json
from pathlib import Path
import re
import sys
import urllib.error

from inspect_nanoka import fetch

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw/nanoka'
# Explicit tower + monster keys prevent copying an older mechanic to a later season.
REVIEWED = {
    (2, '650000053'): ['飞廉之猩受到伤害降低20%。', '被谐度破坏时，飞廉之猩受到伤害提升12.5%，持续至本场战斗结束，可叠加4层。'],
    (4, '607750000'): ['共鸣者生命值大于50%时，无常凶鹭受到的最终伤害提升10%。'],
    (6, '650000049'): ['共鸣者生命值大于50%时，无常凶鹭受到的最终伤害提升10%。'],
    (6, '676750008'): ['辛吉勒姆受到伤害最终降低25%。'],
}
MONSTER_REVIEWED = {
    '海维夏': ('340000210', ['海维夏受到的震谐伤害最终提高100%，其处于震谐·偏移状态下，被谐度破坏命中时，受到的伤害最终提升15%，持续15秒。']),
    '炉芯机骸': ('340000220', ['炉芯机骸的特殊远程攻击「炽能斩」可以被弹回，对炉芯机骸造成伤害，并削减共振度。', '炉芯机骸发动攻击，或经历数次逆势回击后，将暂时暴露左臂的「破绽核心」。此时攻击「破绽核心」，可破坏炉芯机骸的装甲，使其进入无法攻击状态。', '炉芯机骸被附加异常效应时，会直接暴露「破绽核心」。若炉芯机骸拥有异常效应时被破坏装甲，其受到的异常效应伤害最终提升100%，持续30秒。该效果存在期间，不再暴露「破绽核心」。']),
    '无铭探索者': ('340000260', ['无铭探索者的受到【集谐·干涉】效果的层数上限增加2层。', '当无铭探索者处于集谐·偏移的状态时被谐度破坏命中，将被额外附加1层【集谐·干涉】。', '每层【集谐·干涉】将使无铭探索者受到的最终伤害额外提升4%。']),
    '万囮牢·朽躯': ('340000300', ['万囮牢·朽躯被施加虚湮效应时，受到的最终伤害提升5%，最多可叠加5层，持续30秒。', '万囮牢·朽躯被施加的虚湮效应被消耗时，受到的最终伤害提升20%，持续30秒。']),
    '辛吉勒姆': ('340000250', ['声骸技能命中辛吉勒姆时，将为其附加一层【迷航】，最多叠加5层，同名声骸仅可触发一次。', '每层【迷航】使辛吉勒姆受到的最终伤害提升10%。', '【迷航】达到5层时，辛吉勒姆受到的最终伤害额外提升30%。']),
    '封庭械囿': ('320000680', ['附近敌方目标获得护盾时，封庭械囿受到的最终伤害提升10%，持续6秒，每0.5秒可触发一次，最多可叠加4层。']),
    '达妮娅': ('340000280', ['达妮娅受到的异常效应伤害最终提升25%。', '受到【霜结】后，受到的最终伤害提升30%，持续15秒。']),
    '天傀劫煞': ('340000320', ['该敌人被施加异常效应时，受到的最终伤害提升20%，持续6秒。', '该敌人受到的最终电磁效应伤害提升100%。']),
}


def clean(text):
    return html.unescape(re.sub(r'<[^>]*>', '', text or '')).strip()


def period_identity(tower):
    if tower['id'] in (2, 4):
        stage = tower['id'] // 2
        return {'id': f's0-phase{stage}', 'label': f'S0-{stage}', 'name': f'矩阵叠兵S0-{stage}', 'activityName': '矩阵叠兵', 'namingSource': '用户自定义赛季名'}
    match = re.fullmatch(r'(S\d+)第([一二三四五六七八九十])阶段', tower['cycle']['name'])
    if not match: raise ValueError('Unknown matrix period: ' + str(tower['id']))
    stage = '一二三四五六七八九十'.index(match[2]) + 1
    return {'id': f'{match[1].lower()}-phase{stage}', 'label': f'{match[1]}-{stage}', 'name': f'终焉矩阵{match[1]}-{stage}', 'activityName': '终焉矩阵', 'namingSource': 'Nanoka'}


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--data-version', default='3.8')
    args = parser.parse_args()
    version = args.data_version
    def payload(relative):
        path = RAW / (version + '__' + relative.replace('/', '__'))
        if args.refresh or not path.exists():
            path.write_bytes(fetch(f'https://static.nanoka.cc/ww/{version}/{relative}'))
        return read(path)
    index = payload('newtower.json')
    with ThreadPoolExecutor(max_workers=3) as pool:
        towers = list(pool.map(lambda key: payload(f'zh/newtower/{key}.json'), sorted(index, key=int)))
    known = {season['towerId']: season for season in [read(ROOT / entry['file']) for entry in read(ROOT/'config/seasons.json')['seasons']]}
    overrides = read(ROOT/'config/boss_property_overrides.json')
    monster_index = payload('monster.json')
    matrix_names = {wave['name'] for tower in towers for wave in tower['waves'].values()}
    detail_ids = [id for id, monster in monster_index.items() if monster.get('zh') in matrix_names or ('伤痕' in matrix_names and monster.get('zh', '').startswith('伤痕·'))]
    with ThreadPoolExecutor(max_workers=3) as pool:
        details = list(pool.map(lambda id: payload(f'zh/monster/{id}.json'), detail_ids))
    detail_map = {str(detail['id']): detail for detail in details}
    previous_path = ROOT/'config/boss_properties.json'
    previous_manual = {(season['id'], boss['id']): boss for season in (read(previous_path)['seasons'] if previous_path.exists() else []) for boss in season['bosses'] if boss.get('propertySource') == 'user-confirmed'}
    existing_icons = {boss['name']: {key: boss[key] for key in ('icon_file', 'icon_url') if key in boss} for filename in ('bosses_16.json', 'bosses_18.json') for boss in read(ROOT/'data'/filename)['entries']}
    catalog = {'version': 1, 'siteDataVersion': version, 'checkedAt': '2026-11-17', 'indexSource': 'https://ww.nanoka.cc/newtower',
               'scope': '影响玩家对 Boss 输出的伤害增减；排除纯防护、行动变化、Boss 攻击增强及共振度/偏谐积累。', 'seasons': []}
    audit = {'version': 1, 'siteDataVersion': version, 'checkedAt': catalog['checkedAt'], 'towers': [], 'monsters': [{'id': str(detail['id']), 'name': detail['name'], 'description': clean(detail.get('desc_open', '')), 'source': f'https://ww.nanoka.cc/monster/{detail["id"]}'} for detail in details]}
    for tower in towers:
        tower_id = tower['id']
        source = f'https://ww.nanoka.cc/newtower/{tower_id}'
        audit_entry = {'towerId': tower_id, 'source': source, 'dataSource': f'https://static.nanoka.cc/ww/{version}/zh/newtower/{tower_id}.json', 'mode': tower['name'], 'cycle': tower['cycle'], 'waves': []}
        for wave in tower['waves'].values():
            audit_entry['waves'].append({'id': wave['id'], 'monsterId': str(wave['monster_id']), 'name': wave['name'], 'description': clean(wave.get('desc', ''))})
        audit['towers'].append(audit_entry)
        if tower['name'] != '奇点扩张':
            continue
        cycle = tower['cycle']
        identity = period_identity(tower)
        season_id, label = identity['id'], identity['label']
        season = {**identity, 'towerId': tower_id, 'source': source, 'mode': tower['name'], 'bosses': []}
        by_boss = {}
        for wave in tower['waves'].values():
            key = str(wave['monster_id'])
            if key not in by_boss:
                by_boss[key] = {'id': key, 'name': wave['name'], 'alias': wave['name'], 'icon_file': None, 'specialProperties': [], 'status': 'pending', 'propertySource': 'missing', 'sourceWaveIds': [], 'source': source}
            by_boss[key]['sourceWaveIds'].append(wave['id'])
        for boss in by_boss.values():
            descriptions = [wave['description'] for wave in audit_entry['waves'] if wave['monsterId'] == boss['id']]
            excerpts = REVIEWED.get((tower_id, boss['id']), [])
            for excerpt in excerpts:
                if not any(excerpt in description for description in descriptions):
                    raise ValueError(f'Reviewed excerpt changed: {label} / {boss["name"]}: {excerpt}')
            if excerpts:
                boss.update(specialProperties=list(excerpts), status='confirmed', propertySource='nanoka', propertyEvidence=[{'description': excerpt, 'waveIds': [wave['id'] for wave in audit_entry['waves'] if wave['monsterId'] == boss['id'] and excerpt in wave['description']]} for excerpt in excerpts])
            elif any(descriptions):
                boss.update(propertySource='no-confirmed-damage-property', note='页面仅有辅助或非输出机制，或说明与 Boss 名称不符；伤害性质留空待补。')
            if (season_id, boss['id']) in previous_manual and tower_id not in known:
                manual = previous_manual[(season_id, boss['id'])]
                boss.update(specialProperties=manual['specialProperties'], propertySource='user-confirmed', status='confirmed' if manual['specialProperties'] else 'pending', icon_file=manual.get('icon_file'))
            if tower_id in known:
                manual = next((entry for entry in known[tower_id]['bosses'] if entry['id'] == boss['id']), None)
                if manual:
                    boss.update(alias=manual.get('alias', boss['name']), specialProperties=manual.get('specialProperties', []), icon_file=manual['icon_file'])
                    if boss['specialProperties']:
                        boss.update(status='confirmed', propertySource='user-confirmed')
            if boss['name'] in MONSTER_REVIEWED:
                detail_id, properties = MONSTER_REVIEWED[boss['name']]
                detail = detail_map[detail_id]
                assert detail['name'] == boss['name']
                for text in properties:
                    if text not in clean(detail['desc_open']): raise ValueError('Monster description changed: ' + boss['name'])
                boss['monsterSources'] = [{'source': f'https://ww.nanoka.cc/monster/{detail_id}', 'monsterId': detail_id, 'descriptions': properties}]
                if not boss['specialProperties']:
                    display = [text.replace('其处于震谐·偏移状态下', '其处于【震谐·偏移】状态下') for text in properties]
                    boss.update(specialProperties=display, status='confirmed', propertySource='monster-description')
                if boss['name'] == '辛吉勒姆':
                    boss.update(specialProperties=['辛吉勒姆受到伤害最终降低25%。', *properties], status='confirmed', propertySource='user-confirmed', mergeNote='用户确认：25%减伤为此前遗漏，与迷航共同保留，适用于其历期矩阵记录。')
                boss.pop('note', None)
            if not boss['icon_file'] and boss['name'] in existing_icons:
                boss.update(existing_icons[boss['name']])
            if not boss['icon_file']:
                matches = [entry for entry in monster_index.values() if entry.get('zh') == boss['name']]
                if boss['name'] in MONSTER_REVIEWED: matches = [monster_index[MONSTER_REVIEWED[boss['name']][0]]]
                if boss['name'] == '伤痕': matches = [monster_index['340000050']]
                matches = list({entry['icon']: entry for entry in matches}.values())
                if not matches:
                    boss.update(icon_file=None, iconNote='组合波次没有对应的独立图鉴头像，界面使用文字占位。')
                    season['bosses'].append(boss)
                    continue
                if len(matches) != 1: raise ValueError('Ambiguous Boss portrait: ' + boss['name'])
                resource = matches[0]['icon'].removeprefix('/Game/Aki/UI/').split('.')[0]
                url = 'https://static.nanoka.cc/assets/ww/' + resource + '.webp'
                file = 'assets/bosses/' + resource.rsplit('/', 1)[-1] + '.webp'
                target = ROOT / file
                try:
                    if not target.exists(): target.write_bytes(fetch(url))
                    boss.update(icon_file=file, icon_url=url, icon_sha256=hashlib.sha256(target.read_bytes()).hexdigest())
                    existing_icons[boss['name']] = {key: boss[key] for key in ('icon_file', 'icon_url', 'icon_sha256')}
                except urllib.error.HTTPError as error:
                    if error.code != 404: raise
                    boss.update(icon_file=None, icon_url=url, iconNote='来源头像返回404，界面使用文字占位。')
            season['bosses'].append(boss)
        catalog['seasons'].append(season)
    # Named overrides replace earlier text; distinct cluster lineups remain separate.
    for period in catalog['seasons']:
        for boss in period['bosses']:
            correction = overrides['clusters'].get(period['id']) if boss['name'] == '矩阵集群' else overrides['bosses'].get(boss['name'])
            if not correction: continue
            boss.update(correction, status='confirmed' if correction['specialProperties'] else 'pending', propertySource='user-confirmed')
            boss.pop('note', None)
            if correction.get('representativeMonsterId'):
                detail_id = correction['representativeMonsterId']
                monster = monster_index[detail_id]
                assert monster['zh'] == correction['representativeName']
                resource = monster['icon'].removeprefix('/Game/Aki/UI/').split('.')[0]
                url = 'https://static.nanoka.cc/assets/ww/' + resource + '.webp'
                file = 'assets/bosses/' + resource.rsplit('/', 1)[-1] + '.webp'
                target = ROOT/file
                if not target.exists(): target.write_bytes(fetch(url))
                boss.update(icon_file=file, icon_url=url, icon_sha256=hashlib.sha256(target.read_bytes()).hexdigest(), alias=f'{boss["name"]} {monster["zh"]}')
                boss.pop('iconNote', None)
    # User-confirmed rule: the same Boss keeps its damage properties across periods.
    canonical = {}
    preferred = [*known.values(), *catalog['seasons']]
    for period in preferred:
        for boss in period['bosses']:
            key = boss.get('propertyGroup', boss['name'])
            if key == '矩阵集群': continue
            properties = canonical.setdefault(key, [])
            incoming = overrides['bosses'].get(boss['name'], {}).get('specialProperties', boss.get('specialProperties', []))
            for text in incoming:
                key = text.replace(boss['name'], '').replace('该敌人', '')
                if not any(existing.replace(boss['name'], '').replace('该敌人', '') == key for existing in properties): properties.append(text)
    for period in catalog['seasons']:
        for boss in period['bosses']:
            properties = canonical[boss.get('propertyGroup', boss['name'])]
            if boss['specialProperties'] != properties:
                boss['originalSpecialProperties'] = boss['specialProperties']
                boss.update(specialProperties=list(properties), status='confirmed' if properties else 'pending', propertySource='same-boss-user-confirmed', syncNote='按用户确认，同名矩阵Boss的伤害性质跨期同步。')
    save(ROOT/'config/boss_properties.json', catalog)
    save(ROOT/'data/boss_property_sources.json', audit)
    print(json.dumps({'stages': len(catalog['seasons']), 'checked_towers': len(audit['towers']), 'confirmed': sum(bool(b['specialProperties']) for s in catalog['seasons'] for b in s['bosses']), 'pending': sum(not b['specialProperties'] for s in catalog['seasons'] for b in s['bosses'])}))


if __name__ == '__main__':
    main()
