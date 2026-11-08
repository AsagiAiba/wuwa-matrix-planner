"""Download the six element icons referenced by Nanoka's public UI bundle."""
import hashlib
import io
import json
from datetime import datetime, timezone
from PIL import Image
from inspect_nanoka import ROOT, fetch

ELEMENTS = [(1, '冷凝', 'Ice'), (2, '热熔', 'Fire'), (3, '导电', 'Thunder'),
            (4, '气动', 'Wind'), (5, '衍射', 'Light'), (6, '湮灭', 'Dark')]


def main():
    directory = ROOT / 'assets' / 'elements'
    directory.mkdir(parents=True, exist_ok=True)
    entries = []
    for element_id, name, code in ELEMENTS:
        url = f'https://static.nanoka.cc/assets/ww/UIResources/Common/Image/IconElementAttri/T_IconElementAttri{code}.webp'
        data = fetch(url)
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            assert image.format == 'WEBP'
            width, height = image.size
        filename = f'assets/elements/T_IconElementAttri{code}.webp'
        (ROOT / filename).write_bytes(data)
        entries.append({'id': element_id, 'name': name, 'code': code, 'icon_file': filename,
                        'icon_url': url, 'width': width, 'height': height, 'bytes': len(data),
                        'sha256': hashlib.sha256(data).hexdigest()})
        print(f'{name}: {width}x{height}, {len(data)} bytes', flush=True)
    manifest = {'source': 'https://ww.nanoka.cc/',
                'mapping_source': 'https://ww.nanoka.cc/_app/immutable/chunks/BM-A1S15.js',
                'captured_at_utc': datetime.now(timezone.utc).isoformat(), 'entries': entries}
    (ROOT / 'data' / 'elements.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
