"""Inspect public Nanoka page payloads; keep source snapshots for reproducibility."""
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "nanoka"
RAW.mkdir(parents=True, exist_ok=True)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "MatrixPlannerAssets/0.1 (public game-data research)"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def inspect_page(url, name):
    html = fetch(url).decode("utf-8")
    (RAW / f"{name}.html").write_text(html, encoding="utf-8")
    payloads = []
    for attrs, body in re.findall(r"<script([^>]*data-sveltekit-fetched[^>]*)>(.*?)</script>", html, re.S):
        source = re.search(r'data-url="([^"]+)"', attrs).group(1)
        envelope = json.loads(body)
        payload = json.loads(envelope["body"])
        filename = source.split("/ww/")[-1].replace("/", "__")
        (RAW / filename).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        payloads.append({"url": source, "file": filename, "count": len(payload), "keys": list(payload)[:20]})
    print(json.dumps({"page": url, "payloads": payloads, "scripts": re.findall(r'<link href="([^"]+\.js)"', html)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    inspect_page("https://ww.nanoka.cc/", "home")
    inspect_page("https://ww.nanoka.cc/newtower/16", "newtower_16")
