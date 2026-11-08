"""Inspect alternate, explicitly published images for unavailable portraits."""
import json
from inspect_nanoka import RAW, inspect_page

if __name__ == '__main__':
    inspect_page('https://ww.nanoka.cc/character/1512', 'character_1512')
    inspect_page('https://ww.nanoka.cc/monster/340000330', 'monster_340000330')
    monsters = json.loads((RAW / '3.8.3__monster.json').read_text(encoding='utf-8'))
    echoes = json.loads((RAW / '3.8.3__echo.json').read_text(encoding='utf-8'))
    ids = ['340000330', '340000331', '350000290', '350000410', '350000420', '350000440', '350000450', '350000460']
    for key in ids:
        monster = monsters[key]
        print(key, monster, 'ECHO', echoes.get(str(monster.get('echo'))))
