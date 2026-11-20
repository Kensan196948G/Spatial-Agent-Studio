# 本番リリース検証（ラウンド1）結果と対応

実施：2026-11-20 22:00〜22:10 JST（品質ワークベンチ・本番リリース環境）
対象：`https://spatial-agent-studio.mirai-dx-platform.com` / `https://sas-api-prod.mirai-dx-platform.com`
判定：**本番 No-Go**（Critical 1・Major 3・Minor 3）→ 修正着手済み

## 1. 指摘と対応状況

| ID | 重要度 | 指摘 | 対応 | 状態 |
| :-- | :-- | :-- | :-- | :-- |
| `bug_mwozv8cm_7d4fd289` | **Critical** | 公開デモ資格情報＋Originなし許可で本番APIへ到達 | `SAS_DEMO_LOGIN=false`／`SAS_REQUIRE_ORIGIN_AUTH=true`／`SAS_ACCESS_EMAIL_LOGIN=false` を本番unitに設定（PR #43）。実測：login **401**・access **503**・Originなし **403** | **修正済み（実測）** |
| `bug_mwozsmfr_77be423f` | Major | 本番 `spatial-agent-studio.pages.dev` が200（Access保護外） | Pages の Access ポリシー有効化（ダッシュボード・人）または受容 | **未対応** |
| `bug_mwozsmg8_a0e829d0` | Major | 本番DBのバックアップ0件・timer 0件 | `spatial-agent-studio-backup-prod.timer`（03:20・14世代）を有効化＋**初回バックアップ取得**（25KB・sha256） | **対応済み** |
| `bug_mwozsmgp_6e95b720` | Major | 本番監視0件（preview 7450を監視） | `spatial-agent-studio-health-prod.timer`（5分・7460）を有効化。状態ファイル `~/.local/state/spatial-agent-studio/prod/last-health.txt` を確認 | **対応済み** |
| `bug_mwozsuqr_7bb3196d` | Minor | 共有ロールファイルが過剰（9エントリ/20グラント） | ファイルを4件/9グラントに整理し、**env内のインライン `SAS_ACCESS_ROLES` / `SAS_ACCESS_ROLE_DOMAINS` を削除**（ファイルを唯一の正に） | **対応済み（要再起動）** |
| `bug_mwozsure_9c685e36` | Minor | レート制限の記載不一致（実装5回/10分） | ドキュメントを実装値に統一 | **対応済み** |
| `bug_mwozsus3_cd7ed64c` | Minor | 本番の非機能スコープ/目標が未承認 | 承認待ち（人） | **未対応** |

## 2. 追加で発見・封鎖した穴

`POST /api/auth/access` は**本文のメールアドレスを信頼**してセッションを発行していた（Access未検証）。
ロールファイルに載っている任意のメール（管理者を含む）になりすませたため、本番では無効化した。
再開には「Access JWTの検証」または「UIとAPIの同一オリジン化（Access配下）」が必要。

## 3. 封鎖後の本番状態（意図的）

- 本番APIは**セッションを発行できない**（デモ禁止・Accessメール禁止・Origin必須）。
- 正規のログイン経路（Access JWT検証付き）を実装するまで、本番UIはログイン不可。
- これは No-Go 判定に沿った**安全側のロックダウン**。

## 4. 次の工程（Go条件）

1. **入口の同一オリジン化**：`spatial-agent-studio…` を Tunnel（7460）配下に置き、UIとAPIを1ホストに統合。
2. **Access JWT検証**：`Cf-Access-Jwt-Assertion` を検証し、そのemailでロール解決（本文emailを廃止）。
3. `pages.dev` のAccess保護（ダッシュボード）または受容。
4. 非機能目標の承認。
5. 承認/runジャーニーの実行（本番DB書込みの承認を得て）。
6. 上記後に**本番QAラウンド2**。

## 5. 証跡

- QA: 要件7・ケース12（executed 11 / reviewed 1）・欠陥7・レポート v1 `doc_mwozvpf5_f7ef8cc9`・ゲート `gate_mwozwfni_7e335a63`（pending）
- 修正: PR #43（`6ee9881`）／APIテスト 16 passed
- 実測: login 401 `DEMO_LOGIN_DISABLED` / access 503 `ACCESS_EMAIL_LOGIN_DISABLED` / Originなし 403 `ORIGIN_REQUIRED`
- 運用: 本番バックアップ 25,288B（`spatial_agent_studio_prod-20261120T131706Z.dump`）・監視状態 22:15:51 OK
