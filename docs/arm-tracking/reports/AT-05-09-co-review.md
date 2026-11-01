# AT-05・09 CO独立確認（修正後合格）

2026-11-01 CO。実装ファイルは変更していない。

- AT-05：640×480・腕長200pxの点を手計算し、ミラーON/OFF、actorSide、外向きx、下向きyが一致する試験は成功。
- AT-09：AT-06の実際のsolveArmIK/constrainArmPoseを注入し、両腕と片側ロスト、古い再通知、表示中の姿勢からresetする独立試験3件は成功。
- **不合格2件：新世代へ自動移行した後の旧世代通知**。AT-05はgeneration=4を処理した後、generation=3・撮影90msの通知を処理してgeneration=3を返す。AT-09もgeneration=4の右腕を処理した後、generation=3の左腕を受けて、その左腕を復帰させる。旧通知は新通知より前に撮影されたが、遅れて到着したという順序で再現する。

AT-05/09はminGeneration（明示resetの下限）だけでなく、既に採用した現在の世代も下限にして受け付ける必要がある。AT-04が古い結果を捨てることに加え、各段も契約どおり古い世代を採用しない。AT-05は戻り値のgenerationも逆行させない。

再現：`node node_modules/vitest/vitest.mjs run packages/tracking/src/body/association.at05.test.ts packages/core/src/joint/tracking/session.at09.test.ts`。COが期待値を作り、CLの実装を直接呼ぶ。修正後に同じ試験を再実行する。統合の完了条件は通過させない。

## CL修正後の再確認（2026-11-01 10:14 JST）

CLがAT-05・09の実装を修正した。COが同じ6件を期待値の変更なしで再実行し、**6件すべて成功**。両段で現在のgenerationも下限として検査し、AT-05の戻り値の世代も逆行しない。実際のIKを入れた片側ロスト・古い再通知・表示姿勢からの復帰も成功した。上記不合格2件は解消した。旧v1から変わった実装・補助試験・exportはCLがmanifestを更新し、最終対象のSHA-256をCO確認manifestへ残す。

追加のCO試験では、検出順交換・誤ったSDK左右・交差、完全な手首重複、80msより古いPoseと手の組合せ、別の人の遠い手、校正サンプル不足も確認した。AT-05の独立5件・AT-09の独立4件が成功。AT-05/09は **CL v2** のmanifestと実ファイルのSHA-256を照合して確認する。tracking全体268件も成功。
