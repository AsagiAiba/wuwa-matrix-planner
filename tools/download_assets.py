"""Download public Nanoka portraits with deduplication, hashes and provenance."""
import argparse
import hashlib
import io
import json
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image
from inspect_nanoka import ROOT, RAW, fetch

VERSION = "3.8.3"
BASE = "https://static.nanoka.cc"
ALIASES = {"燎照之骑": "摩托", "封庭械囿": "盾山", "无冠者": "无冠者", "天傀劫煞": "天人", "矩阵奇藏": "宝箱"}


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def asset_record(kind, record_id, source, name=None):
    icon = source["icon"].replace("/Game/Aki/UI/", "").split(".")[0]
    return {
        "id": str(record_id), "name": name or source.get("zh") or source.get("name"),
        "name_en": source.get("en"), "icon_source_path": source["icon"],
        "icon_url": f"{BASE}/assets/ww/{icon}.webp",
        "icon_file": f"assets/{kind}/{icon.rsplit('/', 1)[-1]}.webp",
        **{key: source[key] for key in ("rank", "element", "weapon", "monster_id") if key in source},
    }


def download(record):
    path = ROOT / record["icon_file"]
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        try:
            content = path.read_bytes() if path.exists() else fetch(record["icon_url"])
            with Image.open(io.BytesIO(content)) as image:
                image.load()
                if image.format != "WEBP":
                    raise ValueError(f"Expected WebP, got {image.format}")
                width, height = image.size
            if not path.exists():
                path.write_bytes(content)
            time.sleep(0.12)
            return record["icon_file"], {"sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content), "width": width, "height": height}
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--include-monsters', action='store_true', help='Explicitly download the full monster portrait catalog')
    parser.add_argument('--refresh-characters', action='store_true', help='Refresh character portraits, including previously missing files')
    args = parser.parse_args()
    character_manifest = ROOT / 'data' / 'characters.json'
    if character_manifest.exists() and not args.refresh_characters:
        characters = json.loads(character_manifest.read_text(encoding='utf-8'))['entries']
    else:
        source = json.loads((RAW / f'{VERSION}__character.json').read_text(encoding='utf-8'))
        characters = [asset_record('characters', k, v) for k, v in source.items()]
    records = {'characters': characters, 'bosses': []}
    phases, bosses = {}, {}
    for tower_id in (16, 18):
        tower_url = f'{BASE}/ww/{VERSION}/zh/newtower/{tower_id}.json'
        tower = json.loads(fetch(tower_url))
        save_json(RAW / f'{VERSION}__zh__newtower__{tower_id}.json', tower)
        phase = {'tower_id': tower_id, 'source': f'https://ww.nanoka.cc/newtower/{tower_id}', 'cycle': tower['cycle'], 'entries': []}
        seen = set()
        for wave_id, wave in tower['waves'].items():
            if wave['monster_id'] in seen:
                continue
            seen.add(wave['monster_id'])
            entry = asset_record('bosses', wave['monster_id'], wave)
            entry.update(alias=ALIASES.get(wave['name'], wave['name']), source_wave_id=int(wave_id), order=len(phase['entries']) + 1)
            phase['entries'].append(entry)
            key = (entry['id'], entry['icon_url'])
            if key not in bosses:
                bosses[key] = dict(entry, source_tower_ids=[])
            bosses[key]['source_tower_ids'].append(tower_id)
        phases[tower_id] = phase
    records['bosses'] = list(bosses.values())
    to_download = list(records['bosses'])
    if args.refresh_characters or not character_manifest.exists():
        to_download.extend(characters)
    if args.include_monsters:
        monsters = json.loads((RAW / f'{VERSION}__monster.json').read_text(encoding='utf-8'))
        records['monsters'] = [asset_record('monsters', k, v) for k, v in monsters.items()]
        to_download.extend(records['monsters'])
    unique = {entry['icon_file']: entry for entry in to_download}
    prior_report = ROOT / 'data' / 'asset_download_report.json'
    prior_failures = json.loads(prior_report.read_text(encoding='utf-8')).get('failures', []) if prior_report.exists() else []
    retained_paths = {entry['icon_file'] for entry in characters if entry.get('download_failed')}
    metadata, failures = {}, [failure for failure in prior_failures if failure['file'] in retained_paths and failure['file'] not in unique]
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(download, entry): entry for entry in unique.values()}
        for index, future in enumerate(as_completed(futures), 1):
            entry = futures[future]
            try:
                path, details = future.result()
                metadata[path] = details
            except Exception as error:
                failures.append({"id": entry["id"], "name": entry["name"], "file": entry["icon_file"], "url": entry["icon_url"], "error": str(error)})
            if index % 40 == 0:
                print(f"Downloaded/verified {index}/{len(unique)}", flush=True)
    fallbacks = []
    monster_catalog = json.loads((RAW / f'{VERSION}__monster.json').read_text(encoding='utf-8'))
    for failure in list(failures):
        preferred = unique.get(failure['file'])
        if preferred is None or not failure['file'].startswith('assets/bosses/') or '404' not in failure['error']:
            continue
        matches = [(k, v) for k, v in monster_catalog.items() if v.get('zh') == preferred['name']]
        if len(matches) != 1:
            continue
        catalog_id, monster = matches[0]
        fallback = asset_record('bosses', preferred['id'], monster)
        existing = ROOT / 'assets' / 'monsters' / Path(fallback['icon_file']).name
        target = ROOT / fallback['icon_file']
        if existing.exists() and not target.exists():
            shutil.copy2(existing, target)
        try:
            _, details = download(fallback)
        except Exception:
            continue
        metadata[failure['file']] = dict(details, icon_file=fallback['icon_file'], icon_url=fallback['icon_url'], icon_source_path=fallback['icon_source_path'], preferred_icon_url=preferred['icon_url'], preferred_icon_error=failure['error'], icon_variant='monster_catalog_portrait', catalog_monster_id=catalog_id)
        failures.remove(failure)
        fallbacks.append({'id': preferred['id'], 'name': preferred['name'], 'preferred_url': preferred['icon_url'], 'used_url': fallback['icon_url']})
    captured = datetime.now(timezone.utc).isoformat()
    for kind, group in records.items():
        for entry in group:
            if entry['icon_file'] in unique:
                entry.pop('download_failed', None)
                entry.update(metadata.get(entry['icon_file'], {'download_failed': True}))
        source = [phase['source'] for phase in phases.values()] if kind == 'bosses' else f"https://ww.nanoka.cc/{'character' if kind == 'characters' else 'monster'}"
        save_json(ROOT / 'data' / f'{kind}.json', {'source': source, 'site_data_version': VERSION, 'captured_at_utc': captured, 'entries': group})
    for tower_id, phase in phases.items():
        for entry in phase['entries']:
            entry.update(metadata.get(entry['icon_file'], {'download_failed': True}))
        phase.update(site_data_version=VERSION, captured_at_utc=captured)
        save_json(ROOT / 'data' / f'bosses_{tower_id}.json', phase)
    retained = {entry['icon_file']: entry for group in records.values() for entry in group if not entry.get('download_failed')}
    summary = {"version": VERSION, "captured_at_utc": captured, "monster_portraits_enabled": args.include_monsters, "counts": {kind: {"records": len(group), "unique_files": len({entry['icon_file'] for entry in group}), "downloaded_unique_files": len({entry['icon_file'] for entry in group if not entry.get('download_failed')}), "missing_unique_files": len({entry['icon_file'] for entry in group if entry.get('download_failed')})} for kind, group in records.items()}, "phases": {str(k): {'cycle': v['cycle'], 'boss_count': len(v['entries'])} for k, v in phases.items()}, "downloaded_unique_files": len(retained), "total_bytes": sum(entry['bytes'] for entry in retained.values()), "failures": failures}
    summary['fallbacks'] = fallbacks
    save_json(ROOT / "data" / "asset_download_report.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if any(failure['file'] in unique for failure in failures) else 0


if __name__ == "__main__":
    sys.exit(main())
