"""Two parallel gen.py runs of the same part wrote the same version number. Split them back into v1, v2 ... from
their Codex thread folders. Usage: python -I tools/model-authoring/split_parallel.py part thread1 thread2 ..."""
import json, shutil, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）
G = Path.home() / '.codex' / 'generated_images'
part, threads = sys.argv[1], sys.argv[2:]
rp = ROOT / 'records' / f'{part}.json'
rec = json.loads(rp.read_text(encoding='utf8'))
base = rec['versions'][0]
versions = []
for i, th in enumerate(threads, 1):
    imgs = sorted((G / th).glob('*.png'), key=lambda p: p.stat().st_mtime)
    dst = ROOT / 'parts' / part / f'{part}-v{i}.png'
    shutil.copyfile(imgs[-1], dst)
    v = dict(base)
    v.update(version=i, thread=th, source=str(imgs[-1]), file=str(dst.relative_to(ROOT)),
             note='parallel requests with the same prompt; versions split from their thread folders')
    versions.append(v)
rec['versions'] = versions
rp.write_text(json.dumps(rec, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(part, [v['file'] for v in versions])
