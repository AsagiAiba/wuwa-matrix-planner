"""Normalize public Nanoka circuit and Resonator enhancements for the two matrix phases.

This updates the two normalized JSON files and deduplicated assets/circuits icons.
It does not modify stamina rules or infer the meaning of enhancement category keys.
"""
import argparse
import hashlib
import html
import io
import json
import re
import sys
import time
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image

from inspect_nanoka import fetch

ROOT = Path(__file__).resolve().parents[1]
VERSION = '3.8.3'
PHASES = {
    16: ('s2-phase3', '终焉矩阵S2-3（S2第三阶段）', 'S2第三阶段'),
    18: ('s2-phase4', '终焉矩阵S2-4（S2第四阶段）', 'S2第四阶段'),
}


def resolve_description(description, parameters):
    """Replace indexed text parameters without changing percentage strings or line breaks."""
    def parameter(match):
        index = int(match.group(1))
        if index >= len(parameters):
            raise ValueError(f'Missing parameter {{{index}}}')
        return str(parameters[index])

    text = re.sub(r'\{(\d+)\}', parameter, str(description or ''))
    text = re.sub(r'</?color(?:=[^>]*)?>', '', text, flags=re.IGNORECASE)
    text = html.unescape(text).replace('\r\n', '\n')
    if re.search(r'\{\d+\}', text):
        raise ValueError('An unresolved parameter remains')
    if re.search(r'<[^>]+>', text):
        raise ValueError('Unexpected source markup; update the normalizer before displaying it')
    return text.strip()


def icon_reference(source_path):
    prefix = '/Game/Aki/UI/'
    if not source_path.startswith(prefix):
        raise ValueError(f'Unexpected circuit icon resource: {source_path}')
    resource = source_path[len(prefix):].split('.')[0]
    return {
        'icon_source_path': source_path,
        'icon_url': f'https://static.nanoka.cc/assets/ww/{resource}.webp',
        'icon_file': f"assets/circuits/{resource.rsplit('/', 1)[-1]}.webp",
    }


def verify_icon(content, expected_hash=None):
    digest = hashlib.sha256(content).hexdigest()
    if expected_hash and digest != expected_hash:
        raise ValueError('Cached circuit icon hash differs from its saved metadata')
    with Image.open(io.BytesIO(content)) as image:
        image.load()
        if image.format != 'WEBP':
            raise ValueError(f'Expected a real WebP, got {image.format}')
        width, height = image.size
        if width <= 0 or height <= 0:
            raise ValueError('Circuit icon dimensions must be positive')
    return {'icon_sha256': digest, 'icon_bytes': len(content), 'icon_width': width, 'icon_height': height}


def download_icon(icon, expected_hash=None):
    path = ROOT / icon['icon_file']
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            return icon['icon_url'], verify_icon(path.read_bytes(), expected_hash), False
        except (ValueError, OSError):
            pass  # Repair corrupt or replaced cached files from the original source URL.
    for attempt in range(3):
        try:
            content = fetch(icon['icon_url'])
            metadata = verify_icon(content)
            path.write_bytes(content)
            return icon['icon_url'], metadata, True
        except urllib.error.HTTPError as error:
            if error.code == 404 or attempt == 2:
                raise
        except Exception:
            if attempt == 2:
                raise
        time.sleep(attempt + 1)


def normalize_content(tower_id, raw, characters, captured_at):
    season_id, matrix_version, cycle_name = PHASES[tower_id]
    if raw.get('id') != tower_id or raw.get('cycle', {}).get('name') != cycle_name:
        raise ValueError(f'Unexpected phase metadata for tower {tower_id}')
    circuits = []
    for key, circuit in sorted(raw.get('buffs', {}).items(), key=lambda item: int(item[0])):
        circuits.append({
            'id': str(key),
            'name': circuit['name'],
            'description': resolve_description(circuit.get('desc'), circuit.get('param', [])),
            **icon_reference(circuit['icon']),
        })
    enhanced_characters = []
    for character_id, enhancements in sorted(raw.get('roles', {}).items(), key=lambda item: int(item[0])):
        character = characters.get(str(character_id))
        if not character:
            raise ValueError(f'Unknown source character {character_id}')
        enhanced_characters.append({
            'id': str(character_id),
            'name': character['name'],
            'icon_file': character['icon_file'],
            'enhancements': [
                {
                    'sourceKey': str(key),
                    'description': resolve_description(enhancement.get('desc'), enhancement.get('param', [])),
                }
                for key, enhancement in enhancements.items()
            ],
        })
    return {
        'towerId': tower_id,
        'matrixSeason': season_id,
        'matrixVersion': matrix_version,
        'source': f'https://ww.nanoka.cc/newtower/{tower_id}',
        'dataSource': f'https://static.nanoka.cc/ww/{VERSION}/zh/newtower/{tower_id}.json',
        'siteDataVersion': VERSION,
        'capturedAtUtc': captured_at,
        'descriptionNote': '按来源页面展示；保留阶段限定。角色强化分类键不解释为共鸣链或技能等级，且不覆盖独立的体力配置。',
        'circuits': circuits,
        'characters': enhanced_characters,
    }


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--from-cache', action='store_true', help='Use existing raw JSON snapshots; verify/reuse icons, fetching only missing or corrupt icons')
    args = parser.parse_args()
    character_data = json.loads((ROOT / 'data' / 'characters.json').read_text(encoding='utf-8'))
    characters = {str(entry['id']): entry for entry in character_data['entries']}
    captured_at = datetime.now(timezone.utc).isoformat()

    def get_phase(tower_id):
        if args.from_cache:
            path = ROOT / 'data' / 'raw' / 'nanoka' / f'{VERSION}__zh__newtower__{tower_id}.json'
            raw = json.loads(path.read_text(encoding='utf-8'))
        else:
            raw = json.loads(fetch(f'https://static.nanoka.cc/ww/{VERSION}/zh/newtower/{tower_id}.json'))
        result = normalize_content(tower_id, raw, characters, captured_at)
        if len(result['circuits']) != 4 or len(result['characters']) != 13:
            raise ValueError(f'Unexpected source counts for tower {tower_id}')
        return result

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(get_phase, PHASES))
    expected_hashes = {}
    for tower_id in PHASES:
        previous = ROOT / 'data' / f'matrix_content_{tower_id}.json'
        if previous.exists():
            saved = json.loads(previous.read_text(encoding='utf-8'))
            for circuit in saved.get('circuits', []):
                if circuit.get('icon_url') and circuit.get('icon_sha256'):
                    expected_hashes[circuit['icon_url']] = circuit['icon_sha256']
    unique_icons = {circuit['icon_url']: circuit for result in results for circuit in result['circuits']}
    files = {}
    for url, icon in unique_icons.items():
        if icon['icon_file'] in files and files[icon['icon_file']] != url:
            raise ValueError('Different circuit icons would overwrite the same local filename')
        files[icon['icon_file']] = url
    metadata = {}
    failures = []
    downloaded = 0
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(download_icon, icon, expected_hashes.get(url)): icon for url, icon in unique_icons.items()}
        for future, icon in futures.items():
            try:
                url, details, is_new = future.result()
                metadata[url] = details
                downloaded += int(is_new)
            except Exception as error:
                failures.append({'icon_url': icon['icon_url'], 'icon_file': icon['icon_file'], 'error': str(error)})
    if failures:
        print(json.dumps({'unique_icons': len(unique_icons), 'downloaded': downloaded, 'failures': failures}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
    for result in results:
        for circuit in result['circuits']:
            circuit.update(metadata[circuit['icon_url']])
    for result in results:
        destination = ROOT / 'data' / f"matrix_content_{result['towerId']}.json"
        destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f"{destination.name}: {len(result['circuits'])} 回路，{len(result['characters'])} 角色，参数已替换，阶段限定已保留。")
    print(json.dumps({'unique_icons': len(unique_icons), 'downloaded': downloaded, 'verified_reused': len(unique_icons) - downloaded, 'failed': 0}, ensure_ascii=False))


if __name__ == '__main__':
    main()
