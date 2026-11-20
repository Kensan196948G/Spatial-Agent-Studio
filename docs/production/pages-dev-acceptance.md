# 本番 `pages.dev` の受容記録

決定：**2026-11-20（ユーザー選択 1）**
対象：`https://spatial-agent-studio.pages.dev`（本番 Pages プロジェクト）
状態：**受容（アプリは配信していない／302リダイレクトのみ）**

## 1. 現在の実体（実測）

| 項目 | 値 |
| :-- | :-- |
| HTTP | **302 → `https://spatial-agent-studio.mirai-dx-platform.com/`** |
| 配信内容 | リダイレクト用の静的2ファイル（`_redirects` と案内HTML）のみ |
| アプリ | 配信していない（旧ビルドは置換済み） |
| API参照 | なし（旧APIホストへの参照を排除） |
| Access | なし（Cloudflare Pages の Access ポリシーは未設定） |

```bash
$ curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://spatial-agent-studio.pages.dev/
302 https://spatial-agent-studio.mirai-dx-platform.com/
```

## 2. なぜ受容できるか

- **アプリを配信していない**：旧ビルド（デモ資格情報を含む bundle・旧API参照）は削除済み。
  公開されているのは「本番URLへ誘導する」だけの静的ファイル。
- **データに到達しない**：APIは JWT 必須・デモログイン禁止・Origin必須で、pages.dev からの
  XHR では何も取得できない（CORSも不許可）。
- **本番の入口は Access 配下**：カスタムドメインは 302 → Access（メールOTP）。
- 万一改ざんされても、影響は「転送先URLの差し替え」に限定される。

## 3. 残るリスクと緩和

| リスク | 評価 | 緩和 |
| :-- | :-- | :-- |
| 誰でも pages.dev に到達できる | 低（リダイレクトのみ） | 必要なら Pages の Access ポリシーを有効化（ダッシュボード） |
| 転送先の差し替え（乗っ取り） | 低 | CloudflareアカウントのMFA・操作監査で担保 |
| 名称の誤用（本番と誤認） | 低 | 本番URLを README / 画面に明記済み |

## 4. 将来この受容を解除する条件

- 実データを扱う段階になった
- もしくは Pages プロジェクトを削除する（リダイレクトも不要になった時点）

閉鎖する場合の手順は [docs/security/pages-dev-exposure.md](../security/pages-dev-exposure.md) §4 を参照
（Pages の Access ポリシーは**ダッシュボード専用**。APIでは設定できない）。

## 5. 決定履歴

| 日付 | 内容 | 主体 |
| :-- | :-- | :-- |
| 2026-11-20 | 旧ビルドを 302 リダイレクトへ差し替え（本番QAラウンド2のMajor対応） | AI |
| 2026-11-20 | **受容を確定**（アプリ非配信・データ到達不可のため） | ユーザー（選択 1） |
