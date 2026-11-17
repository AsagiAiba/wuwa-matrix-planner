"""Create circuit-only references for all matrix periods, without scoring/stamina rules."""
import json
from pathlib import Path
import sys
from sync_boss_properties import ROOT, RAW, read, save, period_identity
from sync_matrix_content import resolve_description, icon_reference, download_icon


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    periods = []
    for tower_id in range(2, 19, 2):
        tower = read(RAW / f'3.8__zh__newtower__{tower_id}.json')
        circuits = []
        for id, circuit in sorted(tower['buffs'].items(), key=lambda pair: int(pair[0])):
            icon = icon_reference(circuit['icon'])
            _, metadata, _ = download_icon(icon)
            circuits.append({'id': str(id), 'name': circuit['name'], 'description': resolve_description(circuit.get('desc'), circuit.get('param', [])), 'sourceDescription': circuit.get('desc'), 'sourceParameters': circuit.get('param', []), **icon, **metadata})
        periods.append({**period_identity(tower), 'towerId': tower_id, 'source': f'https://ww.nanoka.cc/newtower/{tower_id}', 'dataSource': f'https://static.nanoka.cc/ww/3.8/zh/newtower/{tower_id}.json', 'viewOnly': tower_id not in (16,18), 'circuits': circuits})
    save(ROOT/'config/matrix_references.json', {'version': 1, 'siteDataVersion': '3.8', 'checkedAt': '2026-11-17', 'periods': periods})
    print(json.dumps({'periods': len(periods), 'circuits': sum(len(period['circuits']) for period in periods), 'historicalViewOnly': sum(period['viewOnly'] for period in periods)}))


if __name__ == '__main__': main()
