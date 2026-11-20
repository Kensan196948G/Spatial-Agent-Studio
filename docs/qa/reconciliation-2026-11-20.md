# QA出力と実測の突合記録（2026-11-20 修正後・最終）

対象QAプロジェクト：`prj_mwoil3oo_09e1644b`（Spatial-Agent-Studio）
対象リポジトリ：HEAD `19a5f6a`／修正本体 `fc61e1a`
配備：<https://spatial-agent-studio-preview.pages.dev>（`<meta name="sas-commit">` = **`19a5f6a`**・dirtyなし）

## 0. 読み方（2つの時点）

| 時点 | 内容 | 扱い |
| :-- | :-- | :-- |
| A. 修正前 | 「変更0件・HEAD `0e4a8f7`・欠陥3件未修正」の回帰記録（`doc_mwojvj6d_21205140`） | **履歴**。現判定には使わない |
| B. 修正後 | 15:24〜15:30 の再検証（POST-FIX）＋レポート v3 | **現行** |

## 1. 突合表（主張 → 実測）

| # | QA出力の主張 | 実測 | 判定 |
| :-: | :-- | :-- | :-- |
| 1 | 変更0件・HEAD `0e4a8f7` | main は `19a5f6a`。`fc61e1a` で3件修正 | 古い（時点A） |
| 2 | DEF-01: 500＋`22P02` | **404** `APPROVAL_NOT_FOUND`・22P02なし（APIテストで担保） | 修正済み・closed |
| 3 | DEF-02: smokeタイムアウト | **PASS 8/8**（nav=11・loginForm=0） | 修正済み・closed |
| 4 | DEF-03: `AI: DEMO` 0件 | ヘッダーに常時表示（smoke/E2Eで検証） | 修正済み・closed |
| 5 | unit 11/11 | 変更なし | 一致 |
| 6 | 配備コミット不明 | meta＋設定「配信ビルド」で特定 | 解消 |
| 7 | ロール割当の実機未確認 | 社用ドメイン→`field`／所有者→`agent,hq,it`／未登録→403 | 確認済み |
| 8 | API 4分停止 | health 200・CORS 204・ロール割当復旧 | 解消 |
| 9 | 取込み実行 `unknown` | **13件すべて `passed` に終端化**（reconciled根拠付き）・ゲート `blockers=[]` | **解消** |
| 10 | レポート v2 が最終 | **v3 = version 3 として保存済み**（15:28 / 6,592文字 / hash `77cc5370`） | **作成済み**（下記訂正） |
| 11 | releaseゲート pending | 5件 pending（新規 `gate_mwolm5o4_c78d9b27` を含む）・承認なし | 妥当 |

> **訂正（2026-11-20 15:35）**：前版の突合記録で「v3未作成」と記したが、これは**文書数（reports=5）と版数（versions）を混同**したもの。
> 主要レポート文書 `doc_mwoj7m2l_80ff01c9` は **version 3** を持ち、そこに修正後の再検証が記載されている。

## 2. ワークベンチ実測（15:28 時点・読み取り）

| 項目 | 値 |
| :-- | :-- |
| 欠陥 | **3/3 closed**（未クローズ0） |
| テストケース | executed **39** / reviewed 12（計51） |
| 取込み実行 | **13/13 `passed`**（revision 2・`reconciled` 付与・summary不変） |
| ゲート評価 | `blockers=[]`（「未完了のテスト実行」ブロック解消） |
| レポート | v3（version 3）まで保存。v2は履歴 |
| ゲート | 5件 pending（release×3 / requirements-review / testcase-review） |

### 2.1 v3の「4件passed」の扱い（ユーザー選択1に対応）

v3 §5 に明記済み。要旨：

> `passed` は「検証作業が完了し、検出事項は欠陥/issue/riskとして別管理」の分類（既存のreconciled慣例）。
> 当時の失敗は summary に保持され、DEF-01は修正済み、RI-01/RR-03は要件として追跡。
> この終端化は「失敗履歴の消去」ではない。

対象は #5（55/59・3 failed）／#6（23/24・1 failed）／#9（11/16・5 failed）／#11（defect recheck）。
**要約と欠陥・issue・riskに失敗が残っているため、履歴は失われていない。**

## 3. v3が残したOps指摘への対応

| v3の指摘（B2） | 現在 | 根拠 |
| :-- | :-- | :-- |
| 配備が `e8f6cd7-dirty`（dirtyビルド） | **解消** | `dirty` 判定を配備物に影響するパスへ限定し、`19a5f6a` から再ビルド。meta は **`19a5f6a`**（dirtyなし） |
| どのコミットを検証したか厳密に未確定 | **解消** | 配信ビルド＝`19a5f6a`、コード差分は `fc61e1a`〜`19a5f6a` の4コミット（修正＋ツール＋docs）で追跡可能 |

## 4. 残Go条件（v3の7項を現在値で更新）

| # | 条件 | 状態 |
| :-: | :-- | :-- |
| 1 | P0 2件（RF05-01 run作成／AC-08 Access未登録メール）の実行 or waive | **未達**（waivedのまま・理由記録あり） |
| 2 | 部分検証4件の残り実行 or waive | **未達**（reviewedのまま） |
| 3 | クリーンコミットからの再配備と `sas-commit` 非dirty | **達成**（`19a5f6a`） |
| 4 | Access保護外の受容または保護拡大 | **判断待ち**（[pages-dev-exposure.md](../security/pages-dev-exposure.md) に受容記録・閉鎖手順・トークン手順） |
| 5 | API常設化（systemd等） | **未達**（nohup。unitは `deploy/systemd/` に用意・有効化は人間） |
| 6 | 性能/a11y/クロスブラウザの対象外明示 or 基準定義 | **未達** |
| 7 | requirements-review / testcase-review ゲート処理 | **pending**（人） |

## 5. 判定（AI推奨・承認は人）

- **プレビュー限定：条件付きGO**（欠陥0・取込み実行全終端・ゲートblockers空・クリーン配備）
- **本番：No-Go**（P0未実行・Access保護外・API nohup・非機能未定義）
- 承認は人が行う（AIはゲートを decide しない）

## 6. 再現コマンド

```bash
# 欠陥の再確認
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:7450/api/approvals/AP-999999/decision \
  -H 'content-type: application/json' -H 'origin: https://spatial-agent-studio-preview.mirai-dx-platform.com' \
  -H 'cookie: <managerセッション>' -d '{"decision":"approve"}'   # → 404

# 修正後のスモーク
node scripts/preview-smoke.mjs                                    # → PASS 8/8

# 配備commit（clean）
curl -s https://spatial-agent-studio-preview.pages.dev/ | grep sas-commit   # → 19a5f6a
```
