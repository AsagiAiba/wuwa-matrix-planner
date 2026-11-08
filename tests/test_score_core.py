import unittest
from score_core import load_waves, points_for_damage, points_between_hp, hp_for_points


class ScoreBoundaries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.waves = load_waves()

    def test_every_imported_kill_and_cumulative_boundary(self):
        self.assertEqual(len(self.waves), 75)
        previous = 0
        for wave in self.waves:
            expected = wave['source_cached_points'] if not wave.get('estimated') else wave['full_kill_points']
            self.assertAlmostEqual(points_for_damage(wave, 1, killed=True), expected, places=7)
            self.assertAlmostEqual(wave["cumulative_points_before"], previous)
            previous += wave["full_kill_points"]
            self.assertAlmostEqual(wave["cumulative_points_after"], previous)

    def test_bonus_belongs_to_finisher(self):
        chest = self.waves[4]
        self.assertAlmostEqual(points_between_hp(chest, 1, 0.25), chest["damage_points_at_full_hp"] * 0.75)
        self.assertAlmostEqual(points_between_hp(chest, 0.25, 0), chest["damage_points_at_full_hp"] * 0.25 + 1000)
        self.assertEqual(points_between_hp(chest, 0, 0), 0)

    def test_target_in_bonus_jump(self):
        chest = self.waves[4]
        result = hp_for_points(chest, chest["damage_points_at_full_hp"] + 200)
        self.assertTrue(result["requires_kill"])
        self.assertEqual(result["remaining_hp_fraction"], 0)
        self.assertAlmostEqual(result["overshoot_points"], 800)

    def test_zero_partial_full_and_invalid(self):
        wave = self.waves[0]
        self.assertEqual(hp_for_points(wave, 0)["remaining_hp_fraction"], 1)
        self.assertAlmostEqual(hp_for_points(wave, wave["full_kill_points"] / 2)["remaining_hp_fraction"], 0.5)
        self.assertEqual(hp_for_points(wave, wave["full_kill_points"])["remaining_hp_fraction"], 0)
        for value in (-0.1, 1.1, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                points_for_damage(wave, value)

    def test_r4_growth_does_not_reset_at_r5(self):
        self.assertEqual(self.waves[15]["post_r3_growth_index"], 1)
        self.assertEqual(self.waves[19]["post_r3_growth_index"], 5)
        self.assertEqual(self.waves[20]["post_r3_growth_index"], 6)


if __name__ == "__main__":
    unittest.main()
