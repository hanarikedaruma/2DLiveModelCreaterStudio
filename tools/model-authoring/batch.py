"""Generate several parts with a small amount of parallelism (each part = one gen.py run).
Usage: python -I tools/model-authoring/batch.py --jobs 4 face frontHair ...
"""
import argparse, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）


def run(part):
    for attempt in range(2):
        p = subprocess.run([sys.executable, '-I', str(Path(__file__).resolve().parent / 'gen.py'), part], capture_output=True, text=True, encoding='utf8', errors='replace')
        line = (p.stdout.strip().splitlines() or [''])[-1]
        if p.returncode == 0:
            return f'{part}: {line}'
        time.sleep(20)
    return f'{part}: FAILED {line} {p.stderr[-300:]}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('parts', nargs='+')
    args = ap.parse_args()
    with ThreadPoolExecutor(args.jobs) as ex:
        for r in ex.map(run, args.parts):
            print(r, flush=True)


if __name__ == '__main__':
    main()
