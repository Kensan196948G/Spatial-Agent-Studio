# 本番リリース記録（2026-11-20）

対象：Spatial-Agent-Studio 本番環境
リリース判定：**リリース済み（品質ワークベンチ・全7工程）**／正式判定は人（2026-11-20 23:24 JST）

## 1. リリース内容

| 区分 | 内容 |
| :-- | :-- |
| WebUI | `https://spatial-agent-studio.mirai-dx-platform.com`（Cloudflare Access・メールOTP） |
| API | 同一オリジン `/api/*`（Tunnel → `127.0.0.1:7460`） |
| DB | PostgreSQL `spatial_agent_studio_prod`（デモ内容: sites 5 / runs 2 / approvals 2 / reports 1） |
| 認証 | Access JWT（RS256・JWKS・iss/aud/exp/nbf）検証 → セッション。デモログイン禁止・Origin必須 |
| AI | プロバイダ抽象化＋ゲートウェイ（demo／OpenAI互換、出力契約・レート・予算・監査） |
| 運用 | user systemd（API/Tunnel）・日次バックアップ（14世代）・5分監視 |
| 配備識別 | `<meta name="sas-commit">`＝`44dde60`（HEAD一致） |

## 2. 品質ワークベンチ（本番リリース環境として実行）

| 項目 | 値 |
| :-- | :-- |
| プロジェクト状態 | **closed（リリース済み）** |
| 要件 | 40件（プレビュー30＋本番7＋R2 3） |
| テストケース | 67件 |
| 欠陥 | **11件すべて closed**（Critical 1・Major 3・Minor 7） |
| レポート | 7文書（主要: v4＝プレビュー／本番v1・v2） |
| releaseゲート | **最新 approved**（R1・初期・v2時点は superseded で却下） |
| 検証ラウンド | 本番 **2ラウンド**（R1 No-Go → 修正 → R2 条件付きGO → 承認） |

## 3. リリースまでに解消した主な指摘

| 重要度 | 指摘 | 対応 |
| :-- | :-- | :-- |
| Critical | 公開デモ資格情報＋Originなし許可＋本文メールでのセッション発行 | JWT検証必須・デモ禁止・Origin必須・Accessメールログイン無効化 |
| Major | 本番バックアップ0件 | 日次タイマー＋初回取得＋**復元訓練PASS** |
| Major | 本番監視0件 | 5分タイマー（7460） |
| Major | pages.dev が Access 外で UI 配信 | **302リダイレクトのみ**へ差替＋**受容確定** |
| Major | 旧公開API `sas-api-prod` の残存 | **DNS削除**（到達不可） |
| Minor | ロール過剰付与 | ファイル4件/9グラントに整理（唯一の正） |
| Minor | レート制限の記載不一致 | 5回/10分に統一 |
| Minor | 非機能目標 未承認 | **承認**（性能・可用性・a11y・ブラウザ・保持） |

## 4. 本番の最終状態（実測）

```text
prod domain 302 → Access / UI+API 同一オリジン
pages.dev   302 → 本番ドメイン（アプリ非配信）
sas-api-prod 530（DNS削除・到達不可）
demo login 401 / access-email 503 / Originなし 403 / JWTなし 401
backup 2世代（復元訓練PASS）/ health 5分更新 / 欠陥0
```

## 5. 既知の制約・残タスク（任意）

| 項目 | 内容 |
| :-- | :-- |
| EMAIL_4 | アドレス未取得（`hq,it`）。判明後にロールファイルとAccessポリシーへ追加 |
| 実LLM | 現在は `demo-deterministic`。キー投入で `SAS_AI_PROVIDER=openai` に切替 |
| a11y/ブラウザ | 主要3画面の簡易監査0件。実測はChromiumのみ（本番目標は承認済み） |
| Tunnel ingress整理 | `sas-api-prod` の ingress 削除は次回再起動で反映（DNSは既に削除済み） |
| 実データ | 現在はデモ。実データ投入には匿名化・保存期間・アクセス権の合意が必要 |

## 6. 参照

- 計画：[docs/production/readiness-plan.md](readiness-plan.md)
- 非機能：[docs/production/nonfunctional-targets.md](nonfunctional-targets.md)（承認済み）
- 本番QA：[docs/qa/prod-qa-round1-result.md](../qa/prod-qa-round1-result.md) / [prod-qa-round2-result.md](../qa/prod-qa-round2-result.md)
- 受容：[docs/production/pages-dev-acceptance.md](pages-dev-acceptance.md)
- 運用手順：[docs/deploy.md](../deploy.md) §2.5〜2.9 / [docs/production/incident-runbook.md](incident-runbook.md)
