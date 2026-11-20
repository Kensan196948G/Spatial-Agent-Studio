# CI template (human-applied)

`.github/workflows/**` は DeepSeek Harness の self-evolution policy gate により
**DEPLOY=critical** として AI からの書き込みが拒否されます（承認プロンプトも無効）。

そのため、このディレクトリに CI ワークフローをテンプレートとして置いています。
人間の担当者が次の1コマンドで適用してください。

```bash
mkdir -p .github/workflows
cp templates/ci/ci.yml .github/workflows/ci.yml
```

適用後のCIは以下を実行します（ローカル検証と同じ内容）。

- typecheck / lint
- unit tests
- API integration tests（PostgreSQLサービス + migration + seed）
- build
- secret scan
- Playwright E2E

CIのみで、deploy・本番操作は含みません。
