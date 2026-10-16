"""モデル作りの道具の共通部分（tools/model-authoring）。

プロジェクトのフォルダ（projects/<id>。reference/・parts/・parts-aligned/・authoring/ の設定を持つ）は、
環境変数 MODEL_PROJECT で渡す。道具はリポジトリに、設定と画像はプロジェクトのフォルダに置く。
  PowerShell: $env:MODEL_PROJECT = 'projects/cardigan-bob-20261010'; python -I tools/model-authoring/grid_check.py lowerLidR
  bash:       MODEL_PROJECT=projects/cardigan-bob-20261010 python -I tools/model-authoring/grid_check.py lowerLidR
"""
import os
import subprocess
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parent.parent


def _project() -> Path:
    value = os.environ.get('MODEL_PROJECT')
    if not value:
        raise SystemExit('MODEL_PROJECT（プロジェクトのフォルダ。例: projects/cardigan-bob-20261010）を指定してください')
    p = Path(value)
    if not p.is_absolute():
        p = (Path.cwd() / p).resolve()
    if not (p / 'reference').exists():
        raise SystemExit(f'プロジェクトのフォルダではありません（reference/ が無い）: {p}')
    return p


ROOT = _project()
SCRATCH = ROOT / 'checks'  # 確かめ用の画像（プロジェクトの中。projects/ は Git の管理外）
SCRATCH.mkdir(exist_ok=True)
WORK = REPO / '.cache' / 'codex-work'  # Codex CLI の作業フォルダ（読み取り専用で動かす）


def codex_exe() -> str:
    """ChatGPT アプリに入っている Codex CLI。環境変数 CODEX_EXE があればそれを使い、無ければ入っているパッケージから探す
    （アプリの更新で場所が変わるため、決め打ちにしない）"""
    exe = os.environ.get('CODEX_EXE')
    if exe:
        return exe
    out = subprocess.run(
        ['powershell', '-NoProfile', '-Command', "(Get-AppxPackage -Name 'OpenAI.Codex*' | Select-Object -First 1).InstallLocation"],
        capture_output=True, text=True,
    ).stdout.strip()
    if not out:
        raise SystemExit('Codex CLI が見つかりません（ChatGPT アプリを入れるか、CODEX_EXE を指定する）')
    return str(Path(out) / 'app' / 'resources' / 'codex.exe')
