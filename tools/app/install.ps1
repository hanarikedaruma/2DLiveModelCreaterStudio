# アプリを本番用にビルドして、この PC のユーザーのフォルダに置き、デスクトップとスタートメニューにショートカットを作る。
# 使い方（リポジトリの直下で）:
#   pnpm app:install            ビルドしてから置く（コードを変えたあとはこれで更新する）
#   pnpm app:install -NoBuild   ビルドせずに、いまある本番用の実行ファイルを置く
#   pnpm app:uninstall          置いたアプリとショートカットを消す（環境設定・プロジェクトは消さない）
param([switch]$NoBuild, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$name = '2D Live Model Creator Studio'
$dest = Join-Path $env:LOCALAPPDATA "Programs\$name"
$target = Join-Path $dest 'live2d-studio.exe'
$links = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk"),
  (Join-Path ([Environment]::GetFolderPath('Programs')) "$name.lnk")
)

# 置いたアプリが動いていると上書き・削除できない
function Assert-NotRunning {
  $running = Get-Process live2d-studio -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target }
  if ($running) { throw "アプリが起動しています。閉じてからもう一度実行してください。" }
}

if ($Uninstall) {
  Assert-NotRunning
  foreach ($link in $links) { if (Test-Path $link) { Remove-Item $link -Force } }
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  Write-Host "アプリとショートカットを消しました（環境設定とプロジェクトは残しています）。"
  exit 0
}

if (-not $NoBuild) {
  # リポジトリの中の pnpm（Corepack）と Rust を使う。通しのテスト用の設定（VITE_E2E）は外す
  $env:PATH = "$root\.cache\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"
  $env:COREPACK_HOME = "$root\.cache\corepack"
  Remove-Item Env:VITE_E2E -ErrorAction SilentlyContinue
  Push-Location $root
  try {
    pnpm tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "ビルドに失敗しました（終了コード $LASTEXITCODE）。" }
  } finally {
    Pop-Location
  }
}

$built = Join-Path $root 'apps\desktop\src-tauri\target\release\live2d-studio.exe'
if (-not (Test-Path $built)) { throw "本番用の実行ファイルがありません: $built（-NoBuild を外して実行してください）" }

Assert-NotRunning
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item $built $target -Force
$taskVoiceSource = Join-Path $root 'tools\voice-engine'
$taskVoiceTarget = Join-Path $dest 'voice-engine'
New-Item -ItemType Directory -Force -Path $taskVoiceTarget | Out-Null
# Pythonの生成物を除き、AI音声のコード・素材・ライセンスを配置する。
foreach ($taskVoiceFile in (Get-ChildItem -LiteralPath $taskVoiceSource -File -Recurse | Where-Object { $_.FullName -notmatch '[\\/]__pycache__[\\/]' })) {
  $taskVoiceRelative = $taskVoiceFile.FullName.Substring($taskVoiceSource.Length).TrimStart('\','/')
  $taskVoiceDestination = Join-Path $taskVoiceTarget $taskVoiceRelative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $taskVoiceDestination) | Out-Null
  Copy-Item -LiteralPath $taskVoiceFile.FullName -Destination $taskVoiceDestination -Force
}
# 旧統合版で加えたGPU待機処理は使わない。自分が配置したファイルだけを除く。
$taskObsoleteVoiceFile = Join-Path $taskVoiceTarget 'gpu_warm.py'
if (Test-Path -LiteralPath $taskObsoleteVoiceFile) { Remove-Item -LiteralPath $taskObsoleteVoiceFile -Force }

$shell = New-Object -ComObject WScript.Shell
foreach ($link in $links) {
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = $target
  $shortcut.WorkingDirectory = $dest
  $shortcut.IconLocation = "$target,0"
  $shortcut.Description = $name
  $shortcut.Save()
}

Write-Host "置きました: $target"
foreach ($link in $links) { Write-Host "ショートカット: $link" }
