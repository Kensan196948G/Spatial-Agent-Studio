# ローカルCI（GitHub必須チェック）

## なぜGitHub Actionsではないのか

この環境の DeepSeek Harness には **self-evolution policy gate** があり、
`.github/workflows/**` を **DEPLOY=critical（AIからの書き込み拒否）** と分類します。
そのため、GitHub Actions のワークフローファイルをAIが追加・変更することはできません。

代わりに、**同じ検証をこのホストで実行し、GitHubのコミットステータス
`ci/local-verify` を投稿するローカルCIランナー**を用意しました。
main の ruleset はこのステータスを **Required Check** として要求します。

- 実際に検証コマンドを実行し、すべて成功した場合だけ `success` を投稿します
- 失敗時は `failure` を投稿し、PRはマージできません
- `.github/workflows/**` は変更しません
- 人間が後から GitHub Actions を適用する場合のテンプレートは
  [templates/ci/ci.yml](../templates/ci/ci.yml) に残しています

## 実行方法

```bash
# PRのheadをチェックアウトした状態で
pnpm ci:local
# または特定SHA
pnpm ci:local <sha>
```

実行内容（すべて必須）：

| 順序 | ステップ | 内容 |
| :-- | :-- | :-- |
| 1 | typecheck | `pnpm run typecheck` |
| 2 | lint | `pnpm run lint` |
| 3 | unit | `pnpm run test:unit` |
| 4 | api-integration | `pnpm run test:api`（test DB reset→migrate→seed） |
| 5 | e2e | `pnpm run test:e2e`（test DB reset + build + Playwright 4 tests） |
| 6 | secret-scan | `pnpm run secret-scan` |

成功すると以下を投稿します。

- context：`ci/local-verify`
- state：`success` / `failure`
- description：成功時は検証内容、失敗時は失敗ステップ名
- target_url：対象コミットのGitHub URL

結果サマリは `docs/progress/evidence/ci-local-<sha7>.json` に保存されます。
実行ログは標準出力（必要なら `/tmp` へリダイレクト）に残ります。

## 前提・制約

- このホストで実行するため、**PRのheadをチェックアウトしてから**実行してください
- E2Eはポート7440を使用します。開発APIが起動している場合は停止してください
- test DB（`spatial_agent_studio_test`）をresetします。検証専用DBのみを対象にしています
- `gh` が `repo` スコープで認証済みである必要があります
- GitHub Actionsの代替であり、ホスト停止中は実行できません
- 本番配備は行いません

## mainのRequired Check

ruleset `main-protection` は次を要求します。

- Pull Request経由のマージ
- ステータスチェック `ci/local-verify` の成功
- ブランチ削除・強制Pushの禁止

`ci/local-verify` が未投稿または失敗の場合、auto-mergeは待機/ブロックされます。
