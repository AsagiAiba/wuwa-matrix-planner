"""Verify all local manifests and write the final, explicit missing-file report."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def main():
    report_path = ROOT / 'data' / 'asset_download_report.json'
    report = json.loads(report_path.read_text(encoding='utf-8'))
    entries_by_path = {}
    verified = set()
    for kind in report['counts']:
        group = json.loads((ROOT / 'data' / f'{kind}.json').read_text(encoding='utf-8'))['entries']
        available, missing = set(), set()
        for entry in group:
            relative = entry['icon_file']
            path = ROOT / relative
            entries_by_path[relative] = entry
            if entry.get('download_failed'):
                assert not path.exists(), relative
                missing.add(relative)
                continue
            available.add(relative)
            if relative in verified:
                continue
            content = path.read_bytes()
            assert hashlib.sha256(content).hexdigest() == entry['sha256'], relative
            assert len(content) == entry['bytes'], relative
            with Image.open(path) as image:
                image.load()
                assert image.size == (entry['width'], entry['height']), relative
            verified.add(relative)
        report['counts'][kind].update(downloaded_unique_files=len(available), missing_unique_files=len(missing))
    for failure in report['failures']:
        entry = entries_by_path[failure['file']]
        failure.update(id=entry['id'], name=entry['name'])
    assert len(verified) == report['downloaded_unique_files']
    assert {failure['file'] for failure in report['failures']} == {path for path, entry in entries_by_path.items() if entry.get('download_failed')}
    for tower_id in report.get('phases', {}):
        phase = json.loads((ROOT / 'data' / f'bosses_{tower_id}.json').read_text(encoding='utf-8'))
        assert len(phase['entries']) == report['phases'][tower_id]['boss_count']
        assert all(entry['icon_file'] in verified for entry in phase['entries'])
    if not report.get('monster_portraits_enabled', True):
        assert not (ROOT / 'assets' / 'monsters').exists()
    report['local_integrity_checks_passed'] = len(verified)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'counts': report['counts'], 'verified_files': len(verified), 'missing': len(report['failures'])}, indent=2))


if __name__ == '__main__':
    main()
