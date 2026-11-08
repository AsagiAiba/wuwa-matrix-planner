"""Audit source arithmetic, then extend the same linear progression to the configured round."""
import copy
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build_projected_scores(source, rule):
    original = source['records']
    if any(wave.get('estimated') for wave in original):
        raise ValueError('Projection input must contain source rows only')
    if [wave['wave_index'] for wave in original] != list(range(1, len(original) + 1)):
        raise ValueError('Source waves must be a contiguous prefix')
    audit = []
    for wave in original:
        if wave['round'] < rule['growthStartRound']:
            continue
        n = (wave['round'] - rule['growthStartRound']) * rule['bossesPerRound'] + wave['boss_position']
        growth = 1 + rule['growthPerBoss'] * n
        chest = wave['boss_position'] == rule['bossesPerRound']
        expected = rule['baseHp'] / rule['damagePerPoint'] * rule['roundMultiplier'] * growth * (rule['chestScoreMultiplier'] if chest else 1) + (rule['chestKillBonus'] if chest else 0)
        if not math.isclose(expected, wave['full_kill_points'], rel_tol=1e-12, abs_tol=1e-7):
            raise ValueError(f"Source row does not follow progression: {wave['source_cell']}")
        audit.append({'source_cell': wave['source_cell'], 'wave_index': wave['wave_index'], 'growth_index': n, 'growth': growth, 'difference_points': expected - wave['full_kill_points']})
    if len(audit) < 5:
        raise ValueError('At least one complete later round is needed to extend the rule')
    records = copy.deepcopy(original)
    cumulative = records[-1]['cumulative_points_after']
    templates = original[:rule['bossesPerRound']]
    for index in range(len(original) + 1, rule['maxRound'] * rule['bossesPerRound'] + 1):
        round_number = (index - 1) // rule['bossesPerRound'] + 1
        position = (index - 1) % rule['bossesPerRound'] + 1
        template = templates[position - 1]
        n = (round_number - rule['growthStartRound']) * rule['bossesPerRound'] + position
        growth = 1 + rule['growthPerBoss'] * n
        chest = position == rule['bossesPerRound']
        multiplier = rule['chestScoreMultiplier'] if chest else 1
        bonus = rule['chestKillBonus'] if chest else 0
        damage_points = rule['baseHp'] / rule['damagePerPoint'] * rule['roundMultiplier'] * growth * multiplier
        total_points = damage_points + bonus
        formula = f"={rule['baseHp']}/{rule['damagePerPoint']}*{rule['roundMultiplier']}*(1+{rule['growthPerBoss']}*{n})" + (f'*{multiplier}+{bonus}' if chest else '')
        records.append({
            'wave_index': index, 'round': round_number, 'boss_position': position,
            'alias': template['alias'], 'name': template['name'],
            'source_cell': None, 'source_formula': None, 'source_cached_points': None,
            'estimated': True, 'projection_formula': formula,
            'base_hp_literal': rule['baseHp'], 'estimated_max_hp': rule['baseHp'] * growth,
            'damage_per_base_point': rule['damagePerPoint'], 'round_multiplier': rule['roundMultiplier'],
            'post_r3_growth_index': n, 'post_r3_formula_multiplier': growth,
            'enemy_points_multiplier': multiplier, 'kill_bonus': bonus,
            'damage_points_at_full_hp': damage_points, 'full_kill_points': total_points,
            'cumulative_points_before': cumulative, 'cumulative_points_after': cumulative + total_points,
        })
        cumulative += total_points
    result = copy.deepcopy(source)
    result.update(record_count=len(records), source_record_count=len(original), inferred_record_count=len(records) - len(original), max_round=rule['maxRound'],
                  coverage=f"R1-R8 and first two R9 Bosses from source; remaining R9 and R10-R{rule['maxRound']} inferred",
                  projection_rule=rule, projection_source='data/scores_source.json', projection_audit={'checked_source_rows': len(audit), 'max_absolute_difference_points': max(abs(row['difference_points']) for row in audit)}, records=records)
    return result


def rebuild():
    source_path = ROOT / 'data' / 'scores_source.json'
    active_path = ROOT / 'data' / 'scores.json'
    if not source_path.exists():
        existing = json.loads(active_path.read_text(encoding='utf-8'))
        if existing.get('inferred_record_count') or any(row.get('estimated') for row in existing['records']):
            raise ValueError('Original source snapshot is missing')
        source_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    source = json.loads(source_path.read_text(encoding='utf-8'))
    rule = json.loads((ROOT / 'config' / 'progression.json').read_text(encoding='utf-8'))
    result = build_projected_scores(source, rule)
    active_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    data = rebuild()
    print(json.dumps({key: data[key] for key in ['record_count', 'source_record_count', 'inferred_record_count', 'max_round', 'projection_audit']}, ensure_ascii=False, indent=2))
