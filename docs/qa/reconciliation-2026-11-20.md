# QA出力と実測の突合記録（2026-11-20 修正後）

対象QAプロジェクト：`prj_mwoil3oo_09e1644b`（Spatial-Agent-Studio）
対象リポジトリ：HEAD `e8f6cd7`（修正本体は `fc61e1a`）
配備：<https://spatial-agent-studio-preview.pages.dev>（`<meta name="sas-commit">` = ビルド時HEAD）

## 0. 読み方（重要な前提）

QAセッションの出力には**2つの時点**が混在している。

| 時点 | 内容 | 現在の扱い |
| :-- | :-- | :-- |
| A. 修正前 | 「変更0件・HEAD `0e4a8f7`・欠陥3件未修正・再現」の回帰記録（`doc_mwojvj6d_21205140`） | **履歴**。現状の判定には使わない |
| B. 修正後 | 「配備commit `fc61e1a` を確認、DEF-01は404封筒で再現せず、smokeを実行」 | **現行**。本記録の対象 |

## 1. 突合表（主張 → 実測）

| # | QA出力の主張 | 実測（2026-11-20 15:2x JST） | 判定 |
| :-: | :-- | :-- | :-- |
| 1 | アプリコード変更0件（HEAD `0e4a8f7`） | main は `e8f6cd7`。`fc61e1a` で DEF-01/02/03 を修正済み | **古い（時点A）** |
| 2 | DEF-01: 500＋`22P02` 露出 | `POST /api/approvals/AP-999999/decision` → **404** `APPROVAL_NOT_FOUND`、本文に `22P02` を含まない（`tests/api/app.test.ts` でも回帰担保） | **修正済み** |
| 3 | DEF-02: `preview-smoke` が `#sasLogin` でタイムアウト | `node scripts/preview-smoke.mjs` → **PASS 8/8**（自動サインイン・11画面・ログインフォーム0） | **修正済み** |
| 4 | DEF-03: `AI: DEMO` 0件 | ヘッダーに `AI: DEMO` を常時表示（`#bdgAi`）。E2Eとスモークで検証 | **修正済み** |
| 5 | unit 11/11 PASS | 変更なし（11/11） | 一致 |
| 6 | 配備コミット不明 | `<meta name="sas-commit">`＋システム設定「配信ビルド」で特定可能 | **解消** |
| 7 | Accessロール割当の実機動作が未確認 | 再起動後に実測：社用ドメイン→`field`／所有者→`agent,hq,it`／未登録→403 | **確認済み** |
| 8 | `pkill` でAPIが約4分停止→復旧 | health 200・CORS 204・ロール割当も復旧済み | 解消（申し送り済み） |
| 9 | 取込み実行 `status=unknown` | **13件**（前回11件から増加）。自動ゲートのブロック要因 | **未解決** |
| 10 | レポート v2 が最終 | レポートは5件のまま（**v3未作成**） | **未対応** |
| 11 | 最終releaseゲート申請（pending） | ゲート4件すべて pending（承認なし） | 妥当（承認は人） |

## 2. ワークベンチ実測（読み取り）

`~/.dsh/dsh-qa/data.json` を読み取りで確認（最終更新 2026-11-20 15:26 JST）。

| 項目 | 値 |
| :-- | :-- |
| 欠陥 | **3件すべて closed**（DEF-01/02/03） |
| テストケース | executed **39** / reviewed 12（計51） |
| 取込み実行 | **unknown 13** |
| ゲート | 4件 pending（release×2 / requirements-review / testcase-review） |
| レポート | 5件（v2まで。**v3は未作成**） |

## 3. Go条件（7項）の現状

| # | Go条件 | 状態 |
| :-: | :-- | :-- |
| 1 | DEF-01/02/03 の修正または文書受容 | **達成**（修正 `fc61e1a`・テストで担保） |
| 2 | 未実行17件の実行/waive | 一部実行（executed 34→39）。**残り未整理** |
| 3 | Access保護外の受容判断 | **記録済み**（[docs/security/pages-dev-exposure.md](../security/pages-dev-exposure.md)・暫定受容） |
| 4 | 配備コミット特定 | **達成**（`sas-commit`／設定画面） |
| 5 | API常設化 | **未達**（nohup運用のまま。systemd unitは用意済み・有効化は人間） |
| 6 | 取込み実行の終端化 | **未達**（unknown 13） |
| 7 | レポート v3（修正後の再判定） | **未作成** |

## 4. 残アクション（QAセッション）

1. 取込み実行 **13件** を終端状態へ確定（`unknown` を残さない）。実行記録と突合できないものは `waived`＋理由
2. 未実行ケースの整理（実行 or waived）と executed 件数の更新
3. レポート **v3** を保存（v2は保持）。quality_status と残条件を修正後に合わせる
4. releaseゲートは**申請のみ**（承認・decideは人）。先行 `gate_mwojaxec_cd5bb9e5` と最新 `gate_mwojyuju_b0e309f5` の関係を整理

## 5. 再現コマンド（突合の再実行用）

```bash
# DEF-01
curl -s -o - -w '\n%{http_code}\n' -X POST http://127.0.0.1:7450/api/approvals/AP-999999/decision \
  -H 'content-type: application/json' -H 'origin: https://spatial-agent-studio-preview.mirai-dx-platform.com' \
  -H 'cookie: <managerセッション>' -d '{"decision":"approve"}'
# → 404 {"error":{"code":"APPROVAL_NOT_FOUND",...}}（22P02を含まない）

# DEF-02 / DEF-03
node scripts/preview-smoke.mjs
# → PREVIEW SMOKE: PASS（AI: DEMO badge を含む）

# 配備コミット
curl -s https://spatial-agent-studio-preview.pages.dev/ | grep sas-commit
```
