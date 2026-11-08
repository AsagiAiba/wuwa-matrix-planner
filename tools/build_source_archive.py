"""Create a source ZIP from the exact tracked Git files; omit release binaries."""
import hashlib
import json
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    git = os.environ.get('MATRIX_GIT') or shutil.which('git')
    if not git:
        raise SystemExit('Git executable not found. Set MATRIX_GIT.')
    files = subprocess.check_output([git, 'ls-files', '-z'], cwd=ROOT).decode('utf-8').split('\0')
    files = [name for name in files if name]
    if not files:
        raise SystemExit('Stage or commit source files first.')
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    output = ROOT / 'dist' / f'WuwaMatrixPlanner-v{version}-source.zip'
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in files:
            if name.startswith(('dist/', 'build/', 'outputs/', 'data/raw/')):
                raise SystemExit(f'Unexpected tracked output: {name}')
            archive.write(ROOT / name, f'WuwaMatrixPlanner-v{version}-source/{name}')
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    print(json.dumps({'archive': str(output), 'files': len(files), 'sha256': digest}, ensure_ascii=False))


if __name__ == '__main__':
    main()
