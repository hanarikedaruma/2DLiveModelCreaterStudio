# AT-11 CO独立確認

2026-11-01 CO。**AT-11 CL v2：合格**。CLが共通契約へ診断型を移した版を確認した。`ArmsSection.test.tsx` の旧Fakeの異常系入力変更はAT-03で診断能力を足したことに伴うもので、既存の期待値は維持した。manifest全ファイルのSHA-256一致を確認し、[CO確認manifest](../evidence/co-review-2026-11-01.json)へ記録した。

CO独立試験は計5件が成功。

- `flow.at11.test.ts`：共通FakeArmServiceを使い、キャンセル後に旧サービスのcaptureが完了しても、開始し直した校正を進めない。visibility不足・枠外で待つ。キャンセル後の診断通知で再開しない。640×480のミラー座標と演者／モデルの左右を手計算で確認。
- `ArmsSection.at11.test.tsx`：左右のON/OFFと固定手形を独立にサービスへ渡す。リグ不足の理由を表示し、UIがProject/Environmentを直接書き換えない。古い診断を明示し、詳細を閉じると診断の購読を外す。

`prototypes/arm-tracking/at11-verify-co/run.mjs` の専用Vite・headless Edgeで、1440×1000と800×600の実操作が成功した。main.lockと仮サービスを使い、実カメラは開かない。

- 左右の設定・固定手形、詳細、左右の骨格のミラーON/OFF（右肩x=192→128、枠幅320）、操作欄の横はみ出し0。
- 校正を中断し再開、肘の手順で失敗→再試行→4手順を完了→校正を保存→再校正を中断しても前の校正を保持。
- ページ例外0。[操作結果](../evidence/AT-11/co-ui/run.json)、[800×600全画面](../evidence/AT-11/co-ui/screen-800x600.png)、[800×600校正](../evidence/AT-11/co-ui/calibration-800x600.png)。画像をCOが目視確認した。

長いスクロール領域のelement screenshotは内容がずれるため、`settings-*.png` はレイアウト合否の根拠にしない。全画面と校正ダイアログを根拠とする。800×600のスライダーは短いが、通常操作と範囲の変更は可能。微調整UIを追加する必須不具合とは判断していない。

実サービスの永続化・実カメラでの校正・TauriウィンドウはAT-12・13以降で確認する。
