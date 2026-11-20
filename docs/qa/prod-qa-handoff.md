# 本番リリース環境の品質検証（引き継ぎ）

作成：2026-11-20 21:35 JST
対象：**本番** `https://spatial-agent-studio.mirai-dx-platform.com`
前提：本番API `https://sas-api-prod.mirai-dx-platform.com`（port 7460・本番DB `spatial_agent_studio_prod`）

> この文書は品質ワークベンチ（テストモード）のセッションへ**そのまま貼れる**プロンプトを含む。
> AIは承認（releaseゲートのdecide）をしない。実行と証跡はQAセッション、判断は人。

---

## そのまま貼るプロンプト

```text
Spatial-Agent-Studio の**本番リリース環境**の品質検証をお願いします。

## 対象
- WebUI: https://spatial-agent-studio.mirai-dx-platform.com （Cloudflare Access 保護・メールOTP）
- API:   https://sas-api-prod.mirai-dx-platform.com （本番DB: spatial_agent_studio_prod）
- リポジトリ: /home/kensan/Projects/Business-Project/Spatial-Agent-Studio （main の最新）
- 配備識別: 画面の `<meta name="sas-commit">` と「システム設定 → 配信ビルド」

## ロール（2026-11-20 指定・実測済み）
| 区分 | ロール | 状態 |
| :-- | :-- | :-- |
| EMAIL_2（管理者） | field, agent, hq, it | 200 |
| EMAIL_1（現場担当者） | field | 200 |
| EMAIL_3（現場代理人・所長／本社／IT） | agent, hq, it | 200 |
| EMAIL_4（本社／IT・DX） | hq, it | **未登録**（アドレス判明後に追加） |
| 未登録メール | すべて拒否 | 403 ＋ 監査 ACCESS_ROLE_UNMAPPED |

## 既に実測済み（あなたの再確認と突き合わせてください）
- 本番API health 200 / 本番DBでデモログイン 200 / bootstrap・system/info 200
- AI要約 `POST /api/ai/narrate` 200（demoプロバイダ・数値は計算エンジン由来）
- 監査: ACCESS_ROLE_UNMAPPED・AI_CALL が記録される
- 未認証APIは全て 401、認証試行は10回で 429（レート制限）
- a11y簡易監査（主要3画面）0件 / preview smoke PASS 8/8
- 依存脆弱性 `pnpm audit --prod` 0件

## やってほしいこと（順番どおり）
1. 本番プロジェクトをワークベンチに作成（このリポジトリのワークスペース・本番URLを対象に）
2. 要件を登録（本番の受入条件：認証/ロール・AI安全境界・監査・運用・非機能の対象外明示を含む）
3. テストケースを作成（P0中心。ロール別の画面/操作、AIの拒否・予算、未認証401、監査の改ざん検知、バックアップ復元は範囲外と明記）
4. 実行（**本番環境**。読み取り中心。DB書込みを伴うケースは事前に理由を明示し、実行可否を人に確認）
5. 欠陥は重大度付きで登録（再現手順・実測値・スクリーンショット）
6. テストレポート v1 を保存（事実/推測/未検証を分離。未実行は理由付き）
7. releaseゲートは**申請のみ**（承認・却下は人が行う）

## 禁止
- gate の承認/却下（decide）
- data.json の直接編集・store.persist の直接呼び出し
- 本番DBへの破壊的操作（DROP/DELETE/UPDATE）、Accessポリシーの変更
- サービス（systemd）の停止・再起動
- 実メールアドレスの記録・出力
```

---

## 参考：本番の構成

```text
[利用者] --OTP--> Cloudflare Access --> Pages(spatial-agent-studio) --> UI
                                              |
                                              +--> sas-api-prod (tunnel) --> 127.0.0.1:7460 --> PostgreSQL(spatial_agent_studio_prod)
```

| 項目 | 値 |
| :-- | :-- |
| 本番WebUI | Pages プロジェクト `spatial-agent-studio`／branch main |
| 本番API | `spatial-agent-studio-prod.service`（user systemd・port 7460） |
| Access | アプリ `Spatial Agent Studio Production`（メールOTP・8h） |
| 監査 | 追記専用（SHA-256連鎖）・CSV保全スクリプトあり |
| バックアップ | 日次（`scripts/backup-db.sh`・14世代・復元訓練済み） |
| 監視 | `scripts/healthcheck.sh`（5分タイマーは有効化待ち） |
