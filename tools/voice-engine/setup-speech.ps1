# 読み上げ用の独立環境。通常の発話生成はローカルの固定モデルだけを使う。
param(
  [Parameter(Mandatory=$true)][string]$PythonExecutable,
  [string]$RuntimeDirectory = (Join-Path $env:LOCALAPPDATA '2DLiveStudio\voice-runtime-v1')
)
$ErrorActionPreference = 'Stop'
$taskRuntime = [IO.Path]::GetFullPath($RuntimeDirectory)
$taskPython = Join-Path $taskRuntime '.venv-voice-design\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
  & $PythonExecutable -c "import sys,struct; assert sys.version_info[:2]==(3,12) and struct.calcsize('P')==8"
  if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 x64を指定してください' }
  & $PythonExecutable -m venv (Join-Path $taskRuntime '.venv-voice-design')
  if ($LASTEXITCODE -ne 0) { throw '読み上げ用のPython環境を作れません' }
}
& $taskPython -m pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124
if ($LASTEXITCODE -ne 0) { throw 'CUDA用依存の導入に失敗しました' }
& $taskPython -m pip install -r (Join-Path $PSScriptRoot 'requirements-voice-design.txt')
if ($LASTEXITCODE -ne 0) { throw '読み上げ用依存の導入に失敗しました' }
& $taskPython -X utf8 (Join-Path $PSScriptRoot 'fetch-voice-clone.py') --cache (Join-Path $taskRuntime 'external\voice-design-models')
if ($LASTEXITCODE -ne 0) { throw '読み上げモデルを取得できません' }
Write-Output '読み上げを準備しました。音声の実行環境と同じモデル保存先を指定して使えます。'
