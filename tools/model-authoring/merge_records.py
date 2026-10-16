"""Merge records/<part>.json into generation-record.json."""
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）
parts = {}
for p in sorted((ROOT / 'records').glob('*.json')):
    e = json.loads(p.read_text(encoding='utf8'))
    parts[e['part']] = {k: v for k, v in e.items() if k != 'part'}
out = {'generator': 'codex exec (ChatGPT account image generation); the original is attached to every request',
       'original': 'reference/original.png', 'parts': parts}
(ROOT / 'generation-record.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(len(parts), 'parts')
