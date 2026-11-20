# 本番リリース検証（ラウンド2）と残条件の解消

実施：2026-11-20 22:45〜23:00 JST
判定：**Critical 解消・条件付きGO（本番）**。正式承認は人（PENDING）。

## 1. ラウンド2で解消したもの

| 指摘 | 対応 | 実測 |
| :-- | :-- | :-- |
| Critical（公開デモ資格情報＋Originなし） | JWT検証・デモ禁止・Origin必須 | `ACCESS_JWT_REQUIRED` 401／`DEMO_LOGIN_DISABLED` 401／`ORIGIN_REQUIRED` 403 |
| Major（本番backup 0件） | 初回取得＋日次タイマー | prod dump 複数・sha256一致 |
| Major（本番監視 0件） | 5分タイマー | 状態ファイル更新（7460/OK） |
| Minor（レート制限の記載） | 5回/10分に統一 | 実装と一致 |

## 2. ラウンド2後に実施した追加修正

| 事象 | 原因 | 対応 | 実測 |
| :-- | :-- | :-- | :-- |
| `sas-api-prod` が **404**／本番ドメインが時々404 | **古い tunnel プロセスが二重稼働**し、リクエストが旧設定（ingressなし）へ分散 | 11:00起動の旧 nohup 個体（pid 3722912）を停止 | `sas-api-prod` **200**・本番ドメイン **302** が連続で安定 |
| pages.dev が**旧ビルド**（旧API・404）を配信 | Pages本番プロジェクトが切替前の内容のまま公開 | Pages本番を**302リダイレクト**（本番ドメインへ）に差替 | `https://spatial-agent-studio.pages.dev/` → **302** |
| 配信ビルドが HEAD と不一致 | 切替後の未再ビルド | `dist/web` を main（`44dde60`）から再ビルド | 配信 `sas-commit` = **44dde60** |
| 本番復元訓練が未実施 | — | 最新バックアップで実施 | `sites=5 / runs=2 / approvals=2 / reports=1 / audit=36` で一致・scratch削除 |

## 3. ロール割当の件数不一致（QA実測 9/20 との差）

QAは「9件/20グラント」と計測したが、**現行ファイルは 4件/9グラント**（mtime 22:31、コメント・`@domain`行を除く）。

```
$ node -e '...' # 実行結果
active_entries: 4 grants: 9
```

差の理由：22:31 の整理前に存在した **env内インライン権限（`SAS_ACCESS_ROLES` / `SAS_ACCESS_ROLE_DOMAINS`）** と、
`@domain` 行・コメント行を数えた可能性。**現在はファイルが唯一の正**で、envのインライン定義は削除済み。
未設定アドレスは 403（実測）。

## 4. 残条件（人）

| # | 条件 | 主体 |
| :-: | :-- | :-- |
| 1 | ~~pages.dev の扱い~~ **受容を確定（2026-11-20・選択1）**。アプリ非配信・データ到達不可。詳細は [pages-dev-acceptance.md](../production/pages-dev-acceptance.md) | 人 |
| 2 | ~~非機能目標の承認~~ **承認済み（2026-11-20・選択1）** | 人 |
| 3 | ~~OTPログイン後の画面・ロール別表示の証跡~~ **取得（2026-11-20 22:57、人がOTPでログインしダッシュボード表示・データ一致を確認）** | 人 |

## 5. 証跡

- QA: ラウンド2 要件3・ケース4（executed 3 / reviewed 1）・新規欠陥1・レポート v2 `doc_mwp1m9rk_6fbe26a3`・ゲート `gate_mwp1myhx_73bb6ded`（pending）
- 修正: 本記録・PR（tunnel重複の解消、pages.devのリダイレクト化、配信ビルド整合、復元訓練）
