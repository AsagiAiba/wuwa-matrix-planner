"""Read the supplied XLSX without Excel and audit its arithmetic formulas."""
import ast
import hashlib
import json
import math
import operator
import re
import shutil
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "raw" / "boss分数.xlsx"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
ALIASES = {"摩托": "燎照之骑", "盾山": "封庭械囿", "无冠者": "无冠者", "天人": "天傀劫煞", "宝箱": "矩阵奇藏"}
OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


def arithmetic(formula):
    def visit(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in OPS:
            return OPS[type(node.op)](visit(node.left), visit(node.right))
        raise ValueError("Unsupported expression in source workbook")
    return visit(ast.parse(formula.lstrip("="), mode="eval").body)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    content = SOURCE.read_bytes()
    with zipfile.ZipFile(SOURCE) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(item.itertext()) for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        cells = {}
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        for cell in sheet.findall(".//m:c", NS):
            value, formula = cell.find("m:v", NS), cell.find("m:f", NS)
            text = value.text if value is not None else ""
            if cell.get("t") == "s":
                text = strings[int(text)]
            elif cell.get("t") == "inlineStr":
                text = "".join(cell.find("m:is", NS).itertext())
            cells[cell.get("r")] = {"value": text, "formula": formula.text if formula is not None else None}
    records, cumulative = [], 0.0
    for address, cell in cells.items():
        if not address.startswith("B") or cell["formula"] is None:
            continue
        row = int(address[1:])
        round_number = int(cells[f"A{row}"]["value"].removeprefix("R"))
        alias = cells[f"A{row + 1}"]["value"]
        formula = cell["formula"]
        value, cached = arithmetic(formula), float(cell["value"])
        if not math.isclose(value, cached, rel_tol=1e-12, abs_tol=1e-8):
            raise ValueError(f"Cached result mismatch: {address}")
        match = re.match(r"^(\d+)/1200", formula)
        if not match:
            raise ValueError(f"Unexpected HP term: {address}")
        position = list(ALIASES).index(alias) + 1
        round_multiplier = 1.0 if round_number == 1 else 1.15 if round_number == 2 else 1.25
        growth_index = 0 if round_number <= 3 else (round_number - 4) * 5 + position
        growth = 1 + 0.05 * growth_index
        enemy_multiplier = 1.1 if alias == "宝箱" else 1.0
        bonus = 1000 if alias == "宝箱" else 0
        hp_term = int(match.group(1))
        independently_calculated = hp_term / 1200 * round_multiplier * growth * enemy_multiplier + bonus
        if not math.isclose(value, independently_calculated, rel_tol=1e-12, abs_tol=1e-8):
            raise ValueError(f"Rule mismatch: {address}")
        records.append({
            "wave_index": len(records) + 1, "round": round_number, "boss_position": position,
            "alias": alias, "name": ALIASES[alias], "source_cell": address,
            "source_formula": "=" + formula, "source_cached_points": cached,
            "base_hp_literal": hp_term, "damage_per_base_point": 1200,
            "round_multiplier": round_multiplier, "post_r3_growth_index": growth_index,
            "post_r3_formula_multiplier": growth, "enemy_points_multiplier": enemy_multiplier,
            "kill_bonus": bonus, "damage_points_at_full_hp": value - bonus,
            "full_kill_points": value, "cumulative_points_before": cumulative,
            "cumulative_points_after": cumulative + value,
        })
        cumulative += value
    if not records:
        raise ValueError("The workbook has no supported score formulas")
    destination = ROOT / "data" / "raw" / "boss分数.xlsx"
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE, destination)
    data = {
        "source_file": SOURCE.name, "source_snapshot": "data/raw/boss分数.xlsx",
        "source_sha256": hashlib.sha256(content).hexdigest(), "source_sheet": "Sheet1",
        "imported_at_utc": datetime.now(timezone.utc).isoformat(), "record_count": len(records),
        "formula_checks_passed": len(records), "rounding": "unrounded; in-game rounding is unverified",
        "coverage": "R1-R8 complete; R9 contains only boss positions 1 and 2; no extrapolation",
        "post_r3_growth_interpretation": "Formula factor preserved. Whether it changes physical HP or score conversion needs in-game verification.",
        "records": records,
    }
    (ROOT / "data" / "scores_source.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    from extend_scores import rebuild
    rebuild()
    print(json.dumps({"records": len(records), "checks_passed": len(records), "last_wave": records[-1], "source_sha256": data["source_sha256"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
