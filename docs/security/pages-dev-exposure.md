# `*.pages.dev` 直URLの公開状態 — リスク受容記録

最終更新：2026-11-20
状態：**受容（確定・ユーザー判断 2026-11-20）** ／ 閉鎖手順・トークン手順は本章に記載

> **決定（2026-11-20・選択3）**：APIでは閉鎖できないことを確認済みのため、現時点は
> **受容を確定**する。閉鎖する場合は §4 のダッシュボード手順を人間が実施し、
> §4.0 のサービストークンで自動検証を継続する。実施後は §4 末尾の確認コマンドで
> 302 を実測すること。

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

> **前提（先に実施）**：閉じると自動検証（`scripts/preview-smoke.mjs`）が Access でブロックされる。
> 先に **Access サービストークン**を発行し、検証側にヘッダーを渡せる状態にしておくこと。

### 4.0 サービストークンの発行（自動化を止めない）

1. Zero Trust → **Access** → **Service Auth** → **Create Service Token**
2. Name 例：`sas-preview-smoke`、Duration：必要最小限（例 1年）→ 発行
3. **Client ID / Client Secret は一度しか表示されない**ので、その場で控える
4. 対象の Access アプリ（`Spatial Agent Studio Preview` 等）のポリシーに
   **Service Auth → 発行したトークンを include** で追加（`non_identity` ではなく service token 用の include）
5. ホスト上に 0600 で保存（リポジトリへは置かない）

```bash
cat >> ~/.config/spatial-agent-studio/preview-api.env <<'EOF'
# 自動検証用（Pages を Access で閉じた後も smoke を実行できるようにする）
# CF_ACCESS_CLIENT_ID=...        # ← 実際の値はここに書かない（別ファイル推奨）
# CF_ACCESS_CLIENT_SECRET=...
EOF
chmod 600 ~/.config/spatial-agent-studio/preview-api.env
```

実行例（トークンは環境変数で渡す。`-u` 等でシェル履歴に残さないよう注意）：

```bash
set -a; . ~/.config/spatial-agent-studio/access-smoke.env; set +a
node scripts/preview-smoke.mjs            # pages.dev（Access保護後）
# カスタムドメインで検証する場合
PREVIEW_URL=https://spatial-agent-studio-preview.mirai-dx-platform.com node scripts/preview-smoke.mjs
```

`scripts/preview-smoke.mjs` は `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` が
設定されていれば、API 呼び出しとブラウザの全リクエストへ
`CF-Access-Client-Id` / `CF-Access-Client-Secret` を付与する。
未設定で Access のログイン画面へリダイレクトされた場合は、明示的に FAIL する。

### 4.1 `*.pages.dev` を閉じる

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
| 2026-11-20 | 直URLの閉鎖を試行 → API不可を確認し、ダッシュボード手順を用意したうえで**暫定受容** | ユーザー（選択 1,2） |
| 2026-11-20 | **受容を確定**（現状維持）。閉鎖は人間のダッシュボード操作＋サービストークンで自動検証を維持する条件付き | ユーザー（選択 3） |
