# WebUI 設計仕様（OpenDesign成果物）

## 成果物

| 項目 | 内容 |
| :-- | :-- |
| OpenDesignプロジェクト | `spatial-agent-studio-design`（「Spatial Agent Studio — MVP 画面設計」） |
| 成果物 | `design/webui-design-v1.html` |
| リポジトリ内コピー | [webui-design-v1.html](webui-design-v1.html) |
| 形式 | HTML（単一ファイル、PDF/ZIPエクスポート可能） |
| 登録方法 | `od artifacts create --project spatial-agent-studio-design --name design/webui-design-v1.html --input ...` |
| デザイン方向 | OpenDesign `tech-utility`（Datadog / GitHub系） |
| ステータス | **承認待ち（v1.0）** |

## 位置づけ

本仕様は、既存の承認済みプロトタイプ **V2.1 システム版** のデザイン言語
（ダーク navy、シアン／バイオレット／アンバー、3Dビュー＋AIパネル）を継承し、
個人利用MVPの5画面・3フローに絞り込んだものです。

- 画面構成、状態、API/DB契約、デモ/実接続の境界を記述。
- 実装（`src/web`）は本仕様に沿っています。
- 新規のWebUI設計判断（ログイン画面、承認モーダル、監査画面の構成）を含みます。

## 承認

設計仕様の末尾に、以下の番号選択式の承認欄があります。

1. この内容を承認し、追加改修・運用検証を進める
2. 修正してから再提示する
3. 今回は保留する

現時点では「承認待ち」です。実装は既存V2.1デザインのMVP適用として進めています。
