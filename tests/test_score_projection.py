import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from extend_scores import build_projected_scores


class ScoreProjection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = json.loads((ROOT / 'data/scores_source.json').read_text(encoding='utf-8'))
        cls.rule = json.loads((ROOT / 'config/progression.json').read_text(encoding='utf-8'))
        cls.data = json.loads((ROOT / 'data/scores.json').read_text(encoding='utf-8'))

    def test_source_is_unchanged_and_generation_is_reproducible(self):
        self.assertEqual(self.data['records'][:42], self.source['records'])
        self.assertEqual(self.data, build_projected_scores(self.source, self.rule))
        self.assertEqual(self.data['projection_audit']['checked_source_rows'], 27)
        self.assertEqual(sum(bool(row.get('estimated')) for row in self.data['records']), 33)

    def test_r9_is_completed_and_r10_continues_growth(self):
        rows = self.data['records']
        self.assertAlmostEqual(rows[42]['post_r3_formula_multiplier'], 2.4)
        self.assertAlmostEqual(rows[44]['post_r3_formula_multiplier'], 2.5)
        self.assertAlmostEqual(rows[45]['post_r3_formula_multiplier'], 2.55)
        self.assertAlmostEqual(rows[45]['full_kill_points'], 51501.90109375)
        self.assertAlmostEqual(rows[45]['estimated_max_hp'], 49441825.05)
        self.assertIsNone(rows[42]['source_cell'])

    def test_all_projected_rows_follow_linear_hp_and_original_scoring(self):
        previous = 0
        for row in self.data['records']:
            self.assertEqual(row['cumulative_points_before'], previous)
            previous = row['cumulative_points_after']
            if not row.get('estimated'):
                continue
            index = 5 * (row['round'] - 4) + row['boss_position']
            hp = 19388951 * (1 + 0.05 * index)
            expected = hp / 1200 * 1.25 * (1.1 if row['boss_position'] == 5 else 1) + (1000 if row['boss_position'] == 5 else 0)
            self.assertAlmostEqual(row['full_kill_points'], expected, places=6)
        last = self.data['records'][-1]
        self.assertEqual(last['round'], 15)
        self.assertEqual(last['boss_position'], 5)
        self.assertEqual(last['post_r3_formula_multiplier'], 4)

    def test_changed_source_cannot_be_silently_forced_to_match(self):
        bad = copy.deepcopy(self.source)
        bad['records'][15]['full_kill_points'] += 1
        with self.assertRaises(ValueError):
            build_projected_scores(bad, self.rule)


if __name__ == '__main__':
    unittest.main()
