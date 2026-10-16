# AI専用実行環境。波形加工DLLやVST3を導入しない。
param(
  [Parameter(Mandatory=$true)][string]$PythonExecutable,
  [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA '2DLiveStudio\voice-runtime-v1'),
  [switch]$SkipDownload
)
$ErrorActionPreference = 'Stop'
$taskEngine = $PSScriptRoot
$taskRuntime = [System.IO.Path]::GetFullPath($RuntimeDirectory)
$taskPython = Join-Path $taskRuntime '.venv-quality\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
  & $PythonExecutable -c "import sys,struct; assert sys.version_info[:2]==(3,12) and struct.calcsize('P')==8, 'Python 3.12 x64 is required'"
  if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 x64を指定してください' }
  & $PythonExecutable -m venv (Join-Path $taskRuntime '.venv-quality')
  if ($LASTEXITCODE -ne 0) { throw 'Python環境を作成できません' }
}
& $taskPython -m pip install torch==2.5.1 torchaudio==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124
if ($LASTEXITCODE -ne 0) { throw 'CUDA用依存の導入に失敗しました' }
& $taskPython -m pip install -r (Join-Path $taskEngine 'requirements-lock.txt')
if ($LASTEXITCODE -ne 0) { throw '音声用依存の導入に失敗しました' }
$taskSource = Join-Path $taskRuntime 'external\seed-vc'
$taskRevision = '51383efd921027683c89e5348211d93ff12ac2a8'
if (-not (Test-Path -LiteralPath $taskSource)) {
  if ($SkipDownload) { throw 'AIソースが未導入です' }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $taskSource) | Out-Null
  git clone https://github.com/Plachtaa/seed-vc.git $taskSource
  if ($LASTEXITCODE -ne 0) { throw 'AIソースの取得に失敗しました' }
  git -C $taskSource checkout --detach $taskRevision
  if ($LASTEXITCODE -ne 0) { throw 'AIソースの版を固定できません' }
}
$taskHead = git -C $taskSource rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $taskHead.Trim() -ne $taskRevision) { throw 'AIソースの版が異なります。別の実行環境フォルダを使ってください' }
foreach ($taskFetcher in @('fetch_realtime_models.py','fetch_models.py')) {
  if (-not $SkipDownload) {
    & $taskPython -X utf8 (Join-Path $taskEngine $taskFetcher) --root $taskRuntime
    if ($LASTEXITCODE -ne 0) { throw 'モデルの取得に失敗しました' }
  }
  & $taskPython -X utf8 (Join-Path $taskEngine $taskFetcher) --root $taskRuntime --verify
  if ($LASTEXITCODE -ne 0) { throw 'モデルの検証に失敗しました' }
}
& $taskPython -c "import torch; assert torch.cuda.is_available(), 'CUDA GPU is unavailable'; print(torch.cuda.get_device_name(0))"
if ($LASTEXITCODE -ne 0) { throw 'CUDA対応GPUを確認できません' }
@{python=$taskPython;modelRoot=$taskRuntime} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskEngine 'runtime.json') -Encoding utf8
Write-Output 'AI音声を準備しました。スタジオの［音声・リップシンク］からマイクと出力先を選べます。'
