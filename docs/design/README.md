# WebUI 設計仕様（OpenDesign成果物 / 設計履歴）

## 成果物

| 項目 | 内容 |
| :-- | :-- |
| OpenDesignプロジェクト | `spatial-agent-studio-design`（「Spatial Agent Studio — MVP 画面設計」） |
| 成果物 | `design/webui-design-v1.html` |
| リポジトリ内コピー | [webui-design-v1.html](webui-design-v1.html) |
| 形式 | HTML（単一ファイル、PDF/ZIPエクスポート可能） |
| 登録方法 | `od artifacts create --project spatial-agent-studio-design --name design/webui-design-v1.html --input ...` |
| デザイン方向 | OpenDesign `tech-utility`（Datadog / GitHub系） |
| ステータス | **V2.1原本をUI正本として採用（2026-11-20 ユーザー指示）** |

## 位置づけ

本仕様はMVP初期の5画面設計の記録です。
2026-11-20のユーザー指示により、**V2.1システム版（9画面）の原本をUI正本**として採用し、
`web-v21/` の静的UIシェル＋`bridge.js` で実データへ接続する方式に変更しました。

- 画面構成、状態、API/DB契約、デモ/実接続の境界を記述。
- 実装（`src/web`）は本仕様に沿っています。
- 新規のWebUI設計判断（ログイン画面、承認モーダル、監査画面の構成）を含みます。

## 承認

設計仕様の末尾に、以下の番号選択式の承認欄があります。

1. この内容を承認し、追加改修・運用検証を進める
2. 修正してから再提示する
3. 今回は保留する

V2.1原本の採用により、本仕様の5画面設計は設計履歴として保管します。
