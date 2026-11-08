"""Unrounded score/HP-fraction conversions for source and labeled projected rows.

Projected higher rounds follow config/progression.json, not in-game measurements.
"""
import json
import math
from pathlib import Path


def load_waves():
    return json.loads((Path(__file__).parent / "data" / "scores.json").read_text(encoding="utf-8"))["records"]


def points_for_damage(wave, damage_fraction, *, killed=False):
    if not math.isfinite(damage_fraction) or not 0 <= damage_fraction <= 1:
        raise ValueError("damage_fraction must be between 0 and 1")
    if killed and damage_fraction != 1:
        raise ValueError("A kill requires 100% damage from full HP")
    return wave["damage_points_at_full_hp"] * damage_fraction + (wave["kill_bonus"] if killed else 0)


def points_between_hp(wave, start_hp_fraction, end_hp_fraction):
    """Points for reducing a boss from start HP to end HP; grant bonus on killing."""
    if not (math.isfinite(start_hp_fraction) and math.isfinite(end_hp_fraction)) or not 0 <= end_hp_fraction <= start_hp_fraction <= 1:
        raise ValueError("Require 0 <= end HP <= start HP <= 1")
    damage_points = wave["damage_points_at_full_hp"] * (start_hp_fraction - end_hp_fraction)
    return damage_points + (wave["kill_bonus"] if start_hp_fraction > 0 and end_hp_fraction == 0 else 0)


def hp_for_points(wave, target_points):
    """Minimum full-HP damage for a target; a bonus gap requires killing the boss."""
    if not math.isfinite(target_points) or not 0 <= target_points <= wave["full_kill_points"]:
        raise ValueError("Target must be within this boss's available points")
    damage_max = wave["damage_points_at_full_hp"]
    needs_kill = target_points >= damage_max
    fraction = min(target_points / damage_max, 1)
    earned = points_for_damage(wave, fraction, killed=needs_kill)
    return {"remaining_hp_fraction": 1 - fraction, "requires_kill": needs_kill, "earned_points": earned, "overshoot_points": earned - target_points}
