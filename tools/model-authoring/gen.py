"""Generate one part image with the ChatGPT account's image generation (Codex CLI `codex exec`).

Every request attaches the user's original illustration (reference/original-ref.png) as Image 1.
Parts with a zoom attach an enlarged crop of the original as Image 2 (reference only).
Usage: python -I tools/model-authoring/gen.py <partId> [--note "retry reason"] [--extra path ...]
"""
import argparse, datetime, json, shutil, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 同じフォルダの mauth（python -I では自分のフォルダが入らない）
from mauth import ROOT, WORK as mauth_work, codex_exe  # プロジェクトのフォルダ（環境変数 MODEL_PROJECT）
CODEX = codex_exe()  # ChatGPT アプリの Codex CLI（場所は探す）
WORK = mauth_work
GENERATED = Path.home() / '.codex' / 'generated_images'
RECORDS = ROOT / 'records'  # one file per part so parts can be generated in parallel; merge_records.py builds generation-record.json

WRAPPER = """Use your built-in image generation tool exactly once to create the image described below. The attached files are the reference images: the first attached file is Image 1{extra_names}. Do not run shell commands, do not read or write files, and do not ask questions. After the image has been generated, reply only with the word DONE.
The output image must be {w}x{h} pixels with a transparent background.

"""

HEADER_ZOOM = """Task: make ONE layer image for a layered 2D animation model (Live2D-style rig). This is one layer of an EXISTING finished illustration, not a new drawing.

Image 1 is the user's ORIGINAL illustration (original.png, 1024x1536). It is the only source of truth. Copy every shape, line, color and the art style from Image 1, and look at Image 1 again before drawing each detail.
Image 2 is Image 1 cropped around the target part and enlarged {scale}x without any other change (zoom.png, {w}x{h}, shown on white). Draw on exactly this {w}x{h} canvas, with the part at exactly the same place and size as in Image 2.

Rules:
- Output ONE PNG with a real transparent background (alpha). No background color, no checkerboard pattern, no frame, no text, no extra copies or variations.
- Do not move, zoom, crop, re-center, rotate or straighten the part. The head in Image 1 is slightly tilted (the character's left eye, on the right side of the image, is higher); keep exactly that tilt.
- Draw ONLY the part described below, nothing else, not even partially.
- Where other parts cover this part in Image 1, paint the hidden area as a natural continuation so the part is complete on its own (it will move in the animation). Keep the visible area identical to Image 1.
- Art style of Image 1: soft, pale, watercolor-like anime coloring with thin warm-brown line art. Do not make it more realistic, sharper, glossier, more saturated or more detailed. No 3D shading.
"""

HEADER_EDIT = """Task: make ONE layer image for a layered 2D animation model (Live2D-style rig) by EDITING Image 2. This is one layer of an EXISTING finished illustration, not a new drawing.

Image 1 is the user's ORIGINAL illustration (original.png, 1024x1536). It is the only source of truth for every shape, line, color and the art style; look at it again before drawing each detail.
Image 2 is Image 1 cropped around the target part and enlarged {scale}x without any other change ({w}x{h}, shown on white).

Edit Image 2: keep the target part described below exactly where it is in Image 2 - same position, same size, same outline - and erase everything else to full transparency. Then paint the parts of the target that are hidden behind other things in Image 2 (described below) as a natural continuation of its shapes and colors.

Rules:
- Output ONE PNG of exactly {w}x{h} pixels with a real transparent background (alpha). No background color, no checkerboard pattern, no frame, no text, no extra copies or variations.
- The output must line up pixel for pixel with Image 2: do not move, zoom, crop, re-center, rotate or straighten anything. The head in Image 1 is slightly tilted; keep that tilt.
- Keep the visible area of the part identical to Image 2 (same line art, colors and shading). Draw ONLY the target part.
- Art style of Image 1: soft, pale, watercolor-like anime coloring with thin warm-brown line art. Do not make it more realistic, sharper, glossier, more saturated or more detailed. No 3D shading.
"""

HEADER_EDIT_TARGET = """Task: make ONE layer image for a layered 2D animation model (Live2D-style rig) by EDITING Image 2. This is one layer of an EXISTING finished illustration, not a new drawing.

Image 1 is the user's ORIGINAL illustration (original.png, 1024x1536). It is the source of truth for the character design, the line art and the art style.
Image 3 is the user's TARGET image (1024x1536): the same illustration with the mouth OPEN in a small round shape. It shows exactly how the open mouth must look.
Image 2 is Image 3 cropped around the open mouth and enlarged {scale}x without any other change ({w}x{h}, shown on white).

Edit Image 2: keep the target part described below exactly where it is in Image 2 - same position, same size, same outline - and erase everything else to full transparency.

Rules:
- Output ONE PNG of exactly {w}x{h} pixels with a real transparent background (alpha). No background color, no checkerboard pattern, no frame, no text, no extra copies or variations.
- The output must line up pixel for pixel with Image 2: do not move, zoom, crop, re-center, rotate or straighten anything.
- Keep the visible area of the part identical to Image 2 (same line art, colors and shading). Draw ONLY the target part.
- Art style of Image 1: soft, pale, watercolor-like anime coloring with thin warm-brown line art. Do not make it more realistic, sharper, glossier, more saturated or more detailed. No 3D shading.
"""

HEADER_REF = """Task: make a TURNED-HEAD REFERENCE drawing of an existing character, for rigging a 2D animation model (it shows how the face and the hair should look when the head turns).

Image 1 is the user's ORIGINAL illustration (1024x1536). It is the only source of truth for the character design and the art style.
Image 2 is Image 1 cropped around the head and shoulders and enlarged {scale}x ({w}x{h}).

Redraw Image 2 on exactly the same {w}x{h} canvas with ONLY the head turned as described below. The head rotates on the neck: keep the neck base, the collarbones, the shoulders and the camisole straps exactly where they are in Image 2, and keep the head the same size, at the same height and with the same sideways tilt as in Image 2.
Keep the character identical: the same face and eye shape, eye color and highlights, the same bob haircut with the light-blue inner layer, the same bangs, the same hair ornament (white flowers, crossed gold pins, black ribbon and its two tails), the same gold diamond earrings, the same soft watercolor-like anime coloring and thin warm-brown line art. Do not add or remove anything and do not change the expression (calm closed-mouth smile, eyes open).
Background: plain white. Output ONE image, no text, no extra views or variations.
"""

HEADER_FULL = """Task: make ONE layer image for a layered 2D animation model (Live2D-style rig). This is one layer of an EXISTING finished illustration, not a new drawing.

Image 1 is the user's ORIGINAL illustration (original.png, 1024x1536). It is the only source of truth. Copy every shape, line, color and the art style from Image 1, and look at Image 1 again before drawing each detail.
Draw on exactly the same 1024x1536 canvas as Image 1, with the part at exactly the same place, size and angle as in Image 1.

Rules:
- Output ONE PNG with a real transparent background (alpha). No background color, no checkerboard pattern, no frame, no text, no extra copies or variations.
- Do not move, zoom, crop, re-center, rotate or straighten the part. The head in Image 1 is slightly tilted (the character's left eye, on the right side of the image, is higher); keep exactly that tilt.
- Draw ONLY the part described below, nothing else, not even partially.
- Where other parts cover this part in Image 1, paint the hidden area as a natural continuation so the part is complete on its own (it will move in the animation). Keep the visible area identical to Image 1.
- Art style of Image 1: soft, pale, watercolor-like anime coloring with thin warm-brown line art. Do not make it more realistic, sharper, glossier, more saturated or more detailed. No 3D shading.
"""


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf8'))


def build_prompt(spec, zooms, extra_count):
    zoom = spec.get('zoom')
    if zoom:
        z = zooms[zoom]
        w, h = z['out']
        tmpl = {'edit': HEADER_EDIT, 'reference': HEADER_REF, 'editTarget': HEADER_EDIT_TARGET}.get(spec.get('style'), HEADER_ZOOM)  # 'zoomdraw': draw a new shape on the zoom canvas
        header = tmpl.format(scale=f"{w / z['box'][2]:.2f}".rstrip('0').rstrip('.'), w=w, h=h)
    else:
        w, h = 1024, 1536
        header = HEADER_FULL
    names = ['Image 2'] if zoom else []
    for i in range(extra_count):
        names.append(f'Image {len(names) + 2}')
    extra_names = ''.join(f', the {"second" if i == 0 else "third" if i == 1 else "fourth"} attached file is {n}' for i, n in enumerate(names))
    body = spec['prompt'].strip()
    if spec.get('feedback'):
        body += '\n\n' + spec['feedback'].strip()
    wrapper = WRAPPER.replace('with a transparent background', 'with a plain white background') if spec.get('style') == 'reference' else WRAPPER
    return wrapper.format(extra_names=extra_names, w=w, h=h) + header + '\n' + body + '\n', (w, h)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('part')
    ap.add_argument('--extra', nargs='*', default=[], help='additional reference images (e.g. previous output, marked-up diff)')
    ap.add_argument('--feedback', default='', help='extra instruction appended for a retry')
    ap.add_argument('--timeout', type=int, default=900)
    args = ap.parse_args()

    parts = load_json(ROOT / 'authoring' / 'parts.json')
    zooms = load_json(ROOT / 'authoring' / 'zooms.json')
    spec = dict(parts[args.part])
    if args.feedback:
        spec['feedback'] = args.feedback
    # 'editTarget': 見本（口を開けた絵）の全体を Image 3 として毎回添付する
    target = [ROOT / zooms[spec['zoom']]['source']] if spec.get('style') == 'editTarget' else []
    prompt, (w, h) = build_prompt(spec, zooms, len(target) + len(args.extra))
    attachments = [ROOT / 'reference' / 'original-ref.png']
    if spec.get('zoom'):
        attachments.append(ROOT / 'reference' / f"zoom-{spec['zoom']}.png")
    attachments += target + [Path(p).resolve() for p in args.extra]

    RECORDS.mkdir(exist_ok=True)
    record_path = RECORDS / f'{args.part}.json'
    entry = load_json(record_path) if record_path.exists() else {'part': args.part, 'versions': []}
    version = len(entry['versions']) + 1
    logs = ROOT / 'authoring' / 'logs'
    logs.mkdir(parents=True, exist_ok=True)
    log_path = logs / f'{args.part}-v{version}.jsonl'

    WORK.mkdir(parents=True, exist_ok=True)
    cmd = [CODEX, 'exec', '--skip-git-repo-check', '--ignore-user-config', '-s', 'read-only', '-C', str(WORK), '--json',
           '-c', 'model_reasoning_effort="low"']
    for a in attachments:
        cmd += ['-i', str(a)]
    cmd.append('-')  # -i takes several files, so the prompt goes through stdin
    started = time.time()
    proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding='utf8', errors='replace', timeout=args.timeout)
    log_path.write_text(proc.stdout + '\n#stderr\n' + proc.stderr, encoding='utf8')
    thread = None
    for line in proc.stdout.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get('type') == 'thread.started':
            thread = ev.get('thread_id')
    images = sorted((GENERATED / thread).glob('*.png'), key=lambda p: p.stat().st_mtime) if thread and (GENERATED / thread).exists() else []
    out_dir = ROOT / 'parts' / args.part
    out_dir.mkdir(parents=True, exist_ok=True)
    item = {'version': version, 'createdAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
            'seconds': round(time.time() - started, 1), 'thread': thread, 'canvas': [w, h],
            'attachments': [str(Path(a).relative_to(ROOT)) if str(a).startswith(str(ROOT)) else str(a) for a in attachments],
            'prompt': prompt, 'log': str(log_path.relative_to(ROOT)), 'exitCode': proc.returncode}
    if images:
        src = images[-1]
        dst = out_dir / f'{args.part}-v{version}.png'
        shutil.copyfile(src, dst)
        item.update(source=str(src), file=str(dst.relative_to(ROOT)), status='generated', extraOutputs=[str(p) for p in images[:-1]])
    else:
        item.update(status='failed')
    entry['versions'].append(item)
    record_path.write_text(json.dumps(entry, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps({k: item.get(k) for k in ('version', 'status', 'file', 'seconds', 'thread', 'exitCode')}, ensure_ascii=False))
    if not images:
        sys.exit(1)


if __name__ == '__main__':
    main()
