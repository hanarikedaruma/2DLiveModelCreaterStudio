# I-072 既定値のキーの編集・2026-10-12

選択中のパラメータの既定値も、その組のキーへ記録する。パラメータ未選択時だけ共通の基準を編集する。手動キーのロック、不透明度の既定値同期、流れ線の焼き込みの制限を維持した。CC-020、schemaVersion 7。

## 自動検証

- 全10パッケージ: 309ファイル・2,676件。core67ファイル・682件、desktop167ファイル・1,371件。最初の全体実行の旧表示期待値3件を更新後、desktop全体を再実行し成功。追加の単独軸保護の確認11件とヘルプ3件も成功。
- 全パッケージとe2eの型チェック、全体lint・Prettierが成功。
- 本物のWebView2のe2e: 16ファイル・29件、全件成功。マイク101回/秒、Spout2、復元、モデリング保存、PSD再読込などを含む。
- Edge: 1440×1000・800×600。WebView2: 1440×1000・960×600（WindowsのDPI125%）。選択・変形、メッシュ、輪郭線、ワープで実際にマウスをドラッグした。
- 各ツールで+30を直してから0を直し、+30のキーと全描画頂点を比較した。すべて移動0px。基準のPart・Mesh・Warpは不変。0は手動/ロック済み。
- 右クリックの［このキーの差を消す］で既定値の形を戻し、Undoで戻すことを確認。未選択時の帯も画像で確認した。
- WebView2では各ツールと各サイズで実ファイルへ保存・再読込し、既定値と+30の見た目、全キーの値が一致。JSONの項目順は比較の対象にせず、オブジェクトの値を比較した。版は7のまま。pageerror無し。
- 単体では複数軸・モデル座標の頂点・既定値キーが欠けた旧データ・既定値だけの新規バインディング・不透明度・生成の再実行・回転/曲面の再補間を確認。非ゼロ既定値キーのワープ範囲再調整も既存の回帰テストで保持を確認。

## アプリ更新

通常の識別子で、VITE_E2Eを外した本番ビルドを作成し、`tools/app/install.ps1 -NoBuild`で配置した。リリースと配置済み実行ファイルのSHA256が一致。前回までのI-075/I-086/I-071/I-087/I-088も含む。

配置先は`C:\Users\hanar\AppData\Local\Programs\2D Live Model Creator Studio\live2d-studio.exe`。SHA256は`55ac7d5d4c019d202a2120acd0c406789cf779c63af2042e94587e35914710e2`。配置日時とサイズは[app-update.json](app-update.json)に記録した。

配置済みアプリを起動し、モデリング画面・自動セットアップの名称・表示段階の廃止を確認。本番には検証用の`window.__studio`が含まれず、pageerror無し。検証で起動したアプリだけを閉じた。

## 証跡

- [Edgeの結果](edge.json)、[WebView2の結果と保存比較](native.json)、[アプリ配置](app-update.json)、[配置済みアプリの起動確認](installed-startup.json)、[全体の検証記録](validation.json)
- 画像は`i072-edge-*`、`i072-native-*`。`*-base.png`はパラメータ未選択時の帯。[既定値の輪郭編集](i072-edge-800-vertices-contour.png)、[基準編集の帯](i072-native-1440-vertices-edit-base.png)、[最小サイズのワープ](i072-native-960-warpPoints-edit.png)
- ログ: `.cache/i072-tests.log`（desktop修正前の全体）、`.cache/i072-desktop-final.log`、`.cache/i072-key-final.log`、`.cache/i072-help-final.log`、`.cache/i072-type.log`、`.cache/i072-lint.log`、`.cache/i072-format-final.log`、`.cache/i072-native.log`（全29件）、`.cache/i072-native-final.log`（専用画面・保存・本番配置）。

開発サーバー、native/e2e、本番更新は`.cache/locks/main.lock`で直列化した。専用の識別子・WebViewプロファイル・fixtureの写しで検証した。ユーザーの制作プロジェクトは変更していない。
