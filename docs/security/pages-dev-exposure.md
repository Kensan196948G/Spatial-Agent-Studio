# `*.pages.dev` 直URLの公開状態 — リスク受容記録

最終更新：2026-11-20
状態：**暫定受容（ユーザー判断 2026-11-20）** ／ 閉鎖手順は本章に記載

## 1. 事実（実測）

| 項目 | 実測値 |
| :-- | :-- |
| 対象 | `https://spatial-agent-studio-preview.pages.dev/` |
| HTTP | **200**（Accessの302なし・誰でも閲覧可） |
| カスタムドメイン | `https://spatial-agent-studio-preview.mirai-dx-platform.com` は **302 → Cloudflare Access**（メールOTP） |
| API | `https://sas-api.mirai-dx-platform.com` は公開。データ系はセッション/Bearer必須、CORSは許可Originのみ |
| データ | デモ・サンプルのみ（現場・人物・数値は架空）。実データなし |
| 認証 | アプリ独自ログインは廃止。pages.dev では**自動サインイン**（デモの現場代理人・所長） |

## 2. リスク

- pages.dev の直URLを知っていれば、**Accessを経由せず**にデモ画面を閲覧でき、デモアカウントの権限（承認を含む）で操作できる。
- ただし扱うのは架空データのみで、監査ログは追記専用、APIは認証必須。**実データ・個人情報は存在しない**。
- 配備URLは README と過去の証跡に記載があり、URL secrecy には依存できない。

## 3. なぜAPIで閉じられないか

- Cloudflare Pages の「Access policy」は **ダッシュボード専用**（Workers & Pages → プロジェクト → Settings > General）。
- 公開API（OpenAPI）に Pages プロジェクトの Access ポリシー設定エンドポイントは無い。
- `*.pages.dev` は Cloudflare 所有ドメインのため、通常の Access アプリ（自ゾーンのホスト名）として作成することもできない。
- 現在の資格情報（wrangler OAuth）では Access ポリシーの書き込み権限がない。

→ **閉鎖はダッシュボード操作（人間）でのみ可能**。

## 4. 閉鎖手順（Cloudflare公式 Known Issues 準拠）

1. ダッシュボード → **Workers & Pages** → `spatial-agent-studio-preview` を選択
2. **Settings > General** → **Enable access policy**
   - これでプレビュー配信用の Access アプリが作成される（`*.pages.dev` 本体はまだ対象外）
3. **Access > Applications** → 作成されたプロジェクトのアプリを選択 → **Configure**
4. **Public hostname** の **Subdomain** 欄からワイルドカード `*` を削除して **Save**
   （必要なら Application name も変更）
5. `*.pages.dev` を保護できたので、プレビュー配信を再度有効化する
   - プロジェクト → Settings > General → **Enable access policy** を再選択
   - Accessアプリが2つ（`*.pages.dev` 用 / `*.<site>.pages.dev` 用）になっていることを確認
6. カスタムドメインは既存の Access アプリ（`Spatial Agent Studio Preview`）がそのまま適用される。**カスタムドメイン側の Access ポリシーが無いと認証画面が機能しない**点に注意（公式注意書き）

### 実行後の確認（必須）

```bash
# 直URLがAccessへ302する（200のままなら未適用）
curl -sSI https://spatial-agent-studio-preview.pages.dev/ | head -3
# カスタムドメインは引き続き302（既存のAccess）
curl -sSI https://spatial-agent-studio-preview.mirai-dx-platform.com/ | head -3
```

## 5. 受容している間の緩和策

- カスタムドメイン（関係者向けURL）は Access OTP で保護
- 実データ・個人情報を置かない（README・AGENTS.md の制約）
- アプリ内ヘッダーに **Access 未経由** バッジを表示し、経路の違いを可視化
- 監査ログは追記専用（page.devからの操作も記録される）
- 配備物は `<meta name="sas-commit">` と「システム設定 → 配信ビルド」で特定可能

## 6. 決定履歴

| 日付 | 決定 | 判断者 |
| :-- | :-- | :-- |
| 2026-11-20 | 直URLの閉鎖を試行 → API不可を確認し、**ダッシュボード手順を用意したうえで暫定受容** | ユーザー（選択 1,2） |
