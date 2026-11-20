# 進捗・判断・証跡 — Spatial Agent Studio MVP

最終更新：2026-11-20 13:27 JST

## 1. 現在の状態

| 項目 | 状態 |
| :-- | :-- |
| ローカルMVP（WebUI + API + PostgreSQL） | **完成・検証済み** |
| 主要フロー（出来形管理） | **E2E成功**（ローカル / Cloudflare Preview） |
| 安全離隔フロー | **API/UI成功**（侵入判定・承認権限） |
| 承認・監査 | **成功**（ハッシュ連鎖VERIFIED、改ざん拒否） |
| Cloudflare Pages Preview | **配備済み・実操作確認済み（対象コミット `930415d`）** |
| Cloudflare Tunnel API | **稼働・疎通確認済み** |
| GitHubリポジトリ | **PUBLIC** https://github.com/Kensan196948G/Spatial-Agent-Studio |
| GitHub PR | **#1〜#8 MERGED** https://github.com/Kensan196948G/Spatial-Agent-Studio/pulls?q=is%3Apr |
| マージコミット（PR #1） | `0134a1c63276cbd0f511377b87f874bbc4e76977`（2026-11-20 11:09 JST） |
| ドキュメントPR | **#2〜#5 MERGED** https://github.com/Kensan196948G/Spatial-Agent-Studio/pulls?q=is%3Apr |
| テスト/証跡PR | **#6/#7 MERGED**（安全離隔E2E／最新main再配備） |
| UI改善 | **ライト/ダーク切替・現場セレクタ（5現場）**（PR #10） |
| UI正本 | **V2.1システム版（9画面）原本を静的UIシェルとして採用**（`web-v21/`＋`bridge.js`、PR #11） |
| CIゲート | **`ci/local-verify`（ローカルCI）をRequired Checkとして運用**。PR #8でBLOCKED→success→auto-mergeを実証 |
| main HEAD（PR #11時点） | `7fb67799aef81967d908275b9393b979277ecde9` |
| V2.1 UI | **11画面**。ダッシュボード/3D/承認/監査/**監査ログ**/**システム設定**は実データ、他5画面はV2.1サンプル表示 |
| 追加画面（2026-11-20） | **監査ログ**：全件一覧・種別/主体/検索絞り込み・レコード詳細・SHA-256再計算・CSV。**システム設定**：環境/認証/ロール/データ件数/監査チェーン/ヘルスチェック |
| V2.1 Preview | **配備済み・V2.1 UIで実操作確認済み**（デプロイ `69ed0a62`） |
| Previewカスタムドメイン | **ACTIVE**：`spatial-agent-studio-preview.mirai-dx-platform.com`（Pages検証・証明書ともにactive、CNAMEプロキシ済み） |
| Cloudflare Access（Preview） | **適用済み**：同ドメインにメールOTP（許可メール2件・8時間セッション）。Edgeは302でチームドメインへ |
| Access保護外（pages.dev） | **暫定受容**（2026-11-20 ユーザー判断 1,2）。APIでは閉鎖不可（Pages Accessはダッシュボード専用）。閉鎖手順・緩和策・確認コマンドを [docs/security/pages-dev-exposure.md](../security/pages-dev-exposure.md) に記録 |
| QA引き継ぎ | 欠陥再実行・未実行17件・unknown 11件・レポートv3・releaseゲート申請の手順を [docs/qa/handoff-2026-11-20.md](../qa/handoff-2026-11-20.md) に作成（QAセッションへ貼り付け可） |
| QA指摘の修正（2026-11-20） | **DEF-01**（不正ID→500＋DBエラー露出）を404へ、**DEF-02**（スモークの旧ログイン前提）を自動サインインへ、**DEF-03**（`AI: DEMO`欠落）をヘッダーに追加。配備物にビルドcommitを埋め込み（`<meta name="sas-commit">` / システム設定「配信ビルド」） |
| アプリ認証UI | **ログイン画面なし**：Access通過後にデモセッションを自動確立。ヘッダーに認証状態バッジ（Access 認証済み／未経由） |
| ログアウト | **実装済み**：アプリセッション失効 → Accessログアウト（チームドメイン）へ遷移。pages.dev等では再サインイン画面を表示 |
| メール→ロール | **実装済み**：`/cdn-cgi/access/get-identity` のメールを `POST /api/auth/access` で照合しロール決定（付与ロール内のみ切替可）。割当は**ファイル** `~/.config/spatial-agent-studio/access-roles.txt`（1行1件・0600・git管理外）へ移行。解決順はファイル個別→ファイルドメイン→env。**保存のみで反映（再起動不要）** |
| WebUI配備対象 | `930415d`（Pages `8b5bf4d3` で検証） |
| APIコード | `ae2dfb5`（CORSのPagesサブドメイン対応を含む） |
| main保護 | PR必須 / 削除禁止 / 強制Push禁止（ruleset `main-protection`） |
| GitHub Actions CI | **未適用（任意）**。ハーネスポリシーでworkflow変更不可。`templates/ci/ci.yml` は人間適用用に残置 |
| 設計仕様 | V2.1原本をUI正本として採用（v1.0は設計履歴） |

## 2. 初動Assessment（事実）

- 作業ディレクトリ：`/home/kensan/Projects/Business-Project/Spatial-Agent-Studio`
- 初期状態：Gitリポジトリなし。HTML 3ファイルのみ。
  - 企画・構想案 V1.0（135KB）
  - Standalone V1.1（172KB）
  - システム版 Standalone V2.1（292KB）
- 実行環境：Ubuntu 24.04 / Node 22.22 / pnpm 12.21 / PostgreSQL 18.6 / DSH 0.2.1-rc.4
- 利用可能：GitHub CLI（Kensan196948G）、Cloudflare（wrangler OAuth）、OpenDesign（local daemon / project artifact）、Playwright
- OpenDesign：`~/.dsh/profiles/open-design` と `~/Projects/open-design` のローカルアプリが稼働。`od artifacts create` で成果物登録可能。
- 既存の同種プロジェクト：`Drawing-to-4D Studio`（Vite + TS + PostgreSQL + cloudflared tunnel）を参考。

## 3. MVP範囲（確定）

- 目的：現場の3D確認とAI下書きを、人が承認して確定できる個人利用MVP。
- 利用者：現場代理人（manager、承認可）／現場担当者（staff、承認不可）。
- 主要フロー：
  1. 出来形管理：AI計測 → 帳票ドラフト → 承認 → レポート → 再読込
  2. 重機 安全離隔：60秒走査 → 侵入判定 → 承認/却下
  3. 承認・監査：一覧、承認/却下、ハッシュ連鎖検証
- 対象外：実3DGS、実LLM、SSO、外部連携、本番配備、モバイル詳細最適化。

## 4. 実装したもの

- `src/shared/terrain.ts`：解析的現場モデル（盛土・地山・重機・作業員）
- `src/shared/measurements.ts`：出来形偏差、土量、断面、安全離隔、多角形体積
- `src/api/agent.ts`：6ステップのデモ・オーケストレーター
- `src/api/routes.ts`：認証、現場、AI実行、承認、レポート、監査
- `src/api/audit.ts`：SHA-256ハッシュ連鎖、検証
- `db/migrations/001_init.sql`：8テーブル + 追記専用トリガ
- `scripts/db.ts`：migrate / seed / verify / reset（ガード付き）
- `src/web/`：ログイン、ホーム、3D現場、承認、監査の5画面
- `src/web/viewer/scene.ts`：Canvas2D 3DGS風ビュー（V2.1から移植）
- `tests/unit` / `tests/api` / `e2e`：7 + 8 + 3 テスト
- `docs/design/webui-design-v1.html`：OpenDesign設計仕様 v1.0

## 5. 検証証跡

すべて 2026-11-20 に実行。

| 検証 | コマンド / 対象 | 結果 |
| :-- | :-- | :-- |
| 型検査 | `pnpm run typecheck` | **PASS**（exit 0） |
| Lint | `pnpm run lint` | **PASS**（exit 0） |
| Unit | `pnpm run test:unit` | **PASS 7/7** |
| API Integration | `pnpm run test:api` | **PASS 8/8** |
| E2E（V2.1 UI） | `pnpm run test:e2e` | **PASS 4/4**（ログイン/ホーム5現場9画面 / 現場B選択 / テーマ保持 / AI出来形→承認→レポート→承認履歴→監査） |
| Build | `pnpm run build` | **PASS**（Vite 60 modules） |
| Secret scan | `pnpm run secret-scan` | **PASS**（44 files） |
| DB migrate/seed/verify | `db:migrate` / `db:seed` / `db:verify` | **PASS**（dev/test/preview） |
| 監査改ざん拒否 | `UPDATE audit_events` | **ERROR: append-only**（期待どおり） |
| staff承認拒否 | `POST /approvals/:id/decision` | **HTTP 403 + DENY** |
| Preview health | `GET https://sas-api.../api/health` | **200 / db up** |
| Preview CORS | `OPTIONS /api/bootstrap`（Pages Origin） | **204 + allow-origin** |
| Pages配備 | `wrangler pages deploy` | **200 / deployment complete** |
| **Preview実操作** | ログイン→出来形→承認→再読込→監査 | **成功**（下記） |

### Preview実操作の記録

- URL：<https://spatial-agent-studio-preview.pages.dev>（最新デプロイ：<https://8b5bf4d3.spatial-agent-studio-preview.pages.dev>）
- ログイン：`manager@example.com`
- 3D現場：`site-a`（○○川 築堤・護岸工事）
- AI実行：盛土 出来形管理 → 6ステップ表示
- 承認：`承認して確定` → レポート「出来形管理帳票」表示
- 再読込：レポートがDBから復元
- 監査：`ハッシュ連鎖は整合しています` / `VERIFIED`
- API：`https://sas-api.mirai-dx-platform.com/api/health` → `{"ok":true,"db":"up"}`

詳細：[evidence/preview-verification.md](evidence/preview-verification.md)

## 5.1 GitHub

- リポジトリ：[Kensan196948G/Spatial-Agent-Studio](https://github.com/Kensan196948G/Spatial-Agent-Studio)（PUBLIC）
- PR #1：[feat: Spatial Agent Studio MVP](https://github.com/Kensan196948G/Spatial-Agent-Studio/pull/1)（MERGED / 11:09 JST）
- PR #2：[docs: マージ結果と Cloudflare Preview 再検証を記録](https://github.com/Kensan196948G/Spatial-Agent-Studio/pull/2)（MERGED / 11:12 JST）
- PR #3：[docs: PR #2 と main 保護ルールを進捗記録へ反映](https://github.com/Kensan196948G/Spatial-Agent-Studio/pull/3)（MERGED / 11:13 JST）
- PR #4：[fix: Cloudflare Pages のデプロイ別サブドメインをCORS許可](https://github.com/Kensan196948G/Spatial-Agent-Studio/pull/4)（MERGED / 11:16 JST）
- auto-merge：有効化して予約。必須チェック未設定のため即時マージ
- PR #7：[docs: Previewを最新main 930415dから再配備・再検証](https://github.com/Kensan196948G/Spatial-Agent-Studio/pull/7)（MERGED）
- PR #8：[feat: ローカルCIランナーと必須ステータスチェック](https://github.com/Kensan196948G/Spatial-Agent-Studio/pull/8)（MERGED / CIゲート実証）
- PR #9：[docs: CI必須チェックとauto-mergeの実証記録](https://github.com/Kensan196948G/Spatial-Agent-Studio/pull/9)（MERGED）
- PR #10：[feat: ライト/ダーク切替と現場セレクタ](https://github.com/Kensan196948G/Spatial-Agent-Studio/pull/10)（MERGED）
- PR #11：[feat: V2.1原本のUIシェル＋APIブリッジ](https://github.com/Kensan196948G/Spatial-Agent-Studio/pull/11)（MERGED）
- PR #12：[fix: V2.1ヘッダー調整＋Preview検証証跡](https://github.com/Kensan196948G/Spatial-Agent-Studio/pull/12)（V2.1 Preview検証）
- マージコミット：PR #1=`0134a1c` / PR #2=`87aa915` / PR #3=`a44ad44` / PR #4=`ae2dfb5` / PR #5=`be60590` / PR #6=`930415d` / PR #7=`8850b67` / PR #8=`7702958`
- main HEAD（PR #11時点）：`7fb6779`（V2.1 UIシェル＋APIブリッジ）
- main保護：ruleset `main-protection`（PR必須 / `ci/local-verify`必須 / deletion / non_fast_forward）
- CI：`.github/workflows/**` はハーネスポリシーで追加不可。代わりにローカルCIが `ci/local-verify` を投稿し、PR #8で **BLOCKED → success → auto-merge** を実証。
- ローカル検証：typecheck / lint / unit 7 / API 8 / E2E（V2.1）4 / build / secret-scan すべてPASS。
- Preview再配備：`930415d` から再ビルドし `8b5bf4d3` に配備、安定URLで再スモークPASS（監査11件）。
- CORS修正後：API再起動＋`45b9e8ff` Originのプリフライト確認、再スモークPASS（監査10件）。
- 最新main再配備：`930415d` → `8b5bf4d3`、再スモークPASS（監査11件）。
- CORS追補：PR #4で `<hash>.spatial-agent-studio-preview.pages.dev` を許可。API再起動後に
  `45b9e8ff` Originのプリフライトが204 + allow-originになることを確認。

## 6. デバッグ・修正履歴

| # | 課題 | 原因 | 対応 |
| :-- | :-- | :-- | :-- |
| 1 | pnpm add が ERR_PNPM_IGNORED_BUILDS | pnpm 12のビルド承認 | `pnpm-workspace.yaml` に `onlyBuiltDependencies: [esbuild]` + `pnpm approve-builds --all` |
| 2 | E2E staffテストが失敗 | 画面文言「現在のユーザーには権限がありません」に対しテストが「承認権限がありません」 | テストの正規表現を修正 |
| 3 | 承認モーダルの閉じるボタンがバッジと重なる | 右上の配置競合 | `.modal .approval-head { padding-right: 40px }` + sticky action bar |
| 4 | ログイン見出しが不自然に折返し | フォントサイズ大 | `clamp(21px, 2.3vw, 30px)` + nowrap（モバイルは折返し） |
| 5 | Cloudflare TunnelのDNSが別tunnelを指した | `cloudflared tunnel route dns` が既存tunnelを選択 | Cloudflare APIでCNAMEを新tunnel IDへ修正 |
| 6 | `.github/workflows/ci.yml` が書けない | ハーネス `DEPLOY=critical` ポリシー | ローカルCIランナー＋GitHub必須ステータス `ci/local-verify` で代替。テンプレートも残置 |
| 7 | CI未実行のままマージできる | Required Checkが未設定 | rulesetに `ci/local-verify` を必須追加。PR #8でBLOCKED→success→auto-mergeを実証 |

同じ原因で3ラウンド以上停滞した課題はありません。

## 7. 未完了・ブロッカー

1. **GitHub Actions自体は未適用（任意）**：`.github/workflows/**` はハーネスポリシーでAIから変更できません。
   ただしCIゲートは**ローカルCI＋`ci/local-verify`必須チェック**で確立済み（PR #8で実証）。
   GitHub Actionsも併用したい場合のみ、人間が `templates/ci/ci.yml` を適用してください。
2. **V2.1 UIの実データ範囲**：ダッシュボード/3D/承認/監査は実データ。データ取得/3D基盤/連携/統制/構成/導入計画はV2.1原本のサンプル表示。必要に応じて順次実データへ接続。
3. **Previewの常設化**：現在は `nohup` でAPI/Tunnelを起動。systemd unitは
   `deploy/systemd/` に用意済みだが、ハーネスポリシーによりAIからのサービス操作は制限。
   人間が `~/.config/systemd/user/` へコピーして有効化可能。
4. **Previewの公開範囲**：カスタムドメインはAccess（メールOTP）で保護済み。ただし
   **`*.pages.dev` の直URL（安定URL・デプロイ別ハッシュURL）はAccess対象外**で、
   `sas-api.mirai-dx-platform.com` も公開のまま（アプリ認証のみ）。デモアカウントで誰でもログイン可能。
   実データを入れない。pages.dev側の制限はCloudflareのプラン/構成判断が必要。
5. **本番向け**：実3DGS/LLM/SSO/外部連携はBacklog。本番配備は未実施。

## 8. 次の一手

1. ~~Cloudflare Access OTPとpreviewカスタムドメイン~~ **完了（2026-11-20）**。
   残り：人間によるOTP実ログイン確認、prodドメイン（`spatial-agent-studio.mirai-dx-platform.com`）と
   Pages本番プロジェクト・Accessポリシーは未作成（本番昇格は承認事項）。
2. V2.1の残り5画面を実データへ接続するか判断。
3. Previewを常設化する場合、systemd unitを人間が有効化。
3. 本番化する場合、実データ・認証・外部連携のBacklogを起票。
4. マージ後の追加改修は新しいブランチ + PRで行い、`pnpm ci:local` で `ci/local-verify` を投稿する。
5. GitHub Actionsを併用する場合のみ、CIテンプレートを人間が適用する。
