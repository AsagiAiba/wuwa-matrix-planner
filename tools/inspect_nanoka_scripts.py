import re
from concurrent.futures import ThreadPoolExecutor
from inspect_nanoka import RAW, fetch

NAMES = ['nodes/0.DvI9Jxwa.js', 'nodes/2.BAWhzlYE.js', 'nodes/14.BEKQffPM.js',
         'chunks/DeSgNvaH.js', 'chunks/BWaJ3C7D.js', 'chunks/D-iXv4yy.js', 'chunks/BM-A1S15.js']

def run(name):
    text = fetch('https://ww.nanoka.cc/_app/immutable/' + name).decode('utf-8')
    (RAW / name.replace('/', '__')).write_text(text, encoding='utf-8')
    matches = [text[max(0,m.start()-150):m.end()+250] for m in re.finditer(r'static\.nanoka|\.webp|\.png|/assets/|\.split\("\."\)|IconRoleHead', text)]
    return name, text[:400], matches[:25]

if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(run, NAMES):
            print(result)
