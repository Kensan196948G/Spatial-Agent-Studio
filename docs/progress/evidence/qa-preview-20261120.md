# プレビュー実機QA検証（読み取り専用）— 2026-11-20

> 本ファイルは `docs/progress/evidence/qa-preview-verify.mjs` の実行結果から自動生成した実測記録です。
> **PASS/FAIL は「期待との一致」であり、未実施・判定不能は UNVERIFIED として分離**しています。推測は「推測」と明記します。

## 0. 実施情報

| 項目 | 値 |
| --- | --- |
| 実施時刻（JST） | 2026/11/20 14:14:49 〜 2026/11/20 14:16:54（125秒） |
| 実施時刻（UTC） | 2026-11-20T05:14:49.110Z 〜 2026-11-20T05:16:54.576Z |
| WebUI | https://spatial-agent-studio-preview.pages.dev |
| API | https://sas-api.mirai-dx-platform.com |
| リポジトリHEAD | 0e4a8f7c23b2b44638a51bed43071f4cfbe8752c |
| プレビュー配備コミット | 不明 |
| モード | 読み取り専用（GET + 非破壊 400/401/404 確認、許可された認証POSTのみ） |
| ブラウザ | Playwright chromium (headless) / viewport 1440x1000 |
| 判定合計 | PASS 55 / FAIL 3 / UNVERIFIED 1（全59） |
| 追加確認（承認ステータス別件数・承認画面） | 2026/11/20 14:19:29 〜 2026/11/20 14:20:24 / ログインPOST回数=1 / sessionStorage(sas_session_token) のUIトークンを再利用（追加のAPIログインPOSTなし） |

## 1. 結果サマリ（PASS / FAIL / UNVERIFIED）

| ID | 検証項目 | 期待 | 実測 | 判定 |
| --- | --- | --- | --- | --- |
| ui.noLogin | ログイン画面が表示されない（#sasLogin） | #sasLogin 件数 0 / 非表示 | count=0, visible=false | ✅ PASS |
| ui.bootDash | UI起動後にホームへ遷移 | body[data-page]=dash | data-page=dash | ✅ PASS |
| ui.navCount | ナビ項目数 | 11 | 11 | ✅ PASS |
| ui.siteCount | 現場カード数 | 5 | 5 | ✅ PASS |
| ui.accessBadge | Accessバッジ文言 | Access 未経由（直URL） | Access 未経由 | ✅ PASS |
| ui.roleName | ロール表示（#roleName） | デモ既定は現場代理人・所長 | 現場代理人・所長（デモ） | ✅ PASS |
| ui.pagesAgent | 既定ロールで遷移できた画面数 | 11（うち許可9・ロック2は遷移不可が正） | 9/11 reached, blocked=pipeline,governance | ✅ PASS |
| audit.heading | 監査ログ画面の見出し | 監査ログ ─ 追記専用・ハッシュ連鎖 | 監査ログ ─ 追記専用・ハッシュ連鎖 | ✅ PASS |
| audit.rows | 監査ログ行数（取得件数） | >0 | rows=53, count=53 / 53 件 | ✅ PASS |
| audit.detail | 先頭行クリックで詳細表示（#auDetail） | seq/日時/主体/種別/内容/前ハッシュ/ハッシュ | seq #53 日時 2026/11/20 14:14:50 主体 現場代理人・所長（デモ） 種別 LOGIN 内容 ログイン 前ハッシュ 00daefe7aef1441f844ea73af47709137eda585445d11f9058e4a48baceb0699 この記録のハッシュ b4ec8bdc83c50fb… | ✅ PASS |
| audit.recheck | 再計算照合（#auRecheckRes） | 一致 — 改変されていません | 一致 — 改変されていません | ✅ PASS |
| audit.filter | 種別フィルタの件数表示 | フィルタ後件数が表示される | type=ACCESS_LOGIN, count=10 / 53 件, rows=10 | ✅ PASS |
| audit.searchZero | 検索0件の表示 | 条件に一致する記録がありません。 | 条件に一致する記録がありません。 | ✅ PASS |
| settings.version | 設定画面のバージョン表示 | 0.1.0 | 0.1.0 | ✅ PASS |
| settings.roleRows | ロール表の行数 | 4 | 4 | ✅ PASS |
| settings.accessRow | Cloudflare Access 行 | 未経由（デモ） | 未経由（デモ） | ✅ PASS |
| settings.counts | 件数表示（現場/承認/監査イベント等） | 数値が表示される | {"sites":"5","users":"2","approvals":"1","reports":"1","auditEvents":"53","pending":"0"} | ✅ PASS |
| settings.noEmail | 設定画面にメールが露出しない | false（マスク済み） | hasEmailPattern=false | ✅ PASS |
| settings.health | ヘルスチェック（読み取り） | API 正常 / DB up | ヘルスチェック：API 正常 / DB up / v0.1.0 | ✅ PASS |
| ui.viewer3d | 3Dビューの描画 | canvas が存在し data-page=viewer | page=viewer, canvases=4, size=728x870 | ✅ PASS |
| roles.menu | ロールメニュー項目 | 4（現場担当者/現場代理人・所長/本社/IT・DX） | count=4, names=現場担当者 / 現場代理人・所長 / 本社（工務・安全・品質） / IT・DX部門 | ✅ PASS |
| roles.agent | ロール「現場代理人・所長」の許可/ロック数 | 9許可/2ロック | 9許可/2ロック (locked=pipeline,governance) | ✅ PASS |
| roles.hq | ロール「本社（工務・安全・品質）」の許可/ロック数 | 9許可/2ロック | 9許可/2ロック (locked=pipeline,governance) | ✅ PASS |
| roles.it | ロール「IT・DX部門」の許可/ロック数 | 11許可/0ロック | 11許可/0ロック (locked=なし) | ✅ PASS |
| roles.field | ロール「現場担当者」の許可/ロック数 | 7許可/4ロック | 7許可/4ロック (locked=integration,governance,audit,settings) | ✅ PASS |
| lock.noNavigate | 現場担当者でロック画面（audit）へ遷移しない | body[data-page] 不変 | viewer → viewer (changed=false) | ✅ PASS |
| lock.toast | ロック時のトースト文言 | 「現場担当者」ロールではこの画面を利用できません… | 「現場担当者」ロールではこの画面を利用できません（Entra IDグループで制御・模擬） | ✅ PASS |
| approve.defs | ROLE.defs.approve の実測 | field=false, agent=true, hq=false, it=false | {"field":false,"agent":true,"hq":false,"it":false} | ✅ PASS |
| approve.disabledContext | 現場担当者で #apYes disabled を確認できる文脈 | モーダル未表示でも disabled が確認できること | modalShown=false, apYes.disabled=false, disabledAttr=false, currentRole=field | ⚠️ UNVERIFIED |
| ui.pagesIT | 既定ロールでロックされていた画面をITロールで実測 | 2画面が到達可能 | 2/2 reached (pipeline,governance) | ✅ PASS |
| api.health | GET /api/health | 200 / ok=true, db=up, version=0.1.0, aiMode=demo-deterministic, time あり | status=200 {"ok":true,"db":"up","version":"0.1.0","time":"2026-11-20T05:16:52.830Z","aiMode":"demo-deterministic"} | ✅ PASS |
| api.cors | OPTIONS /api/bootstrap（CORS preflight） | 204/200, allow-origin=https://spatial-agent-studio-preview.pages.dev | status=204, origin=https://spatial-agent-studio-preview.pages.dev, headers=content-type, authorization | ✅ PASS |
| api.bootstrap401 | GET /api/bootstrap（トークンなし） | 401 UNAUTHORIZED | status=401, code=UNAUTHENTICATED | ✅ PASS |
| api.me401 | GET /api/auth/me（不正トークン） | 401 UNAUTHORIZED | status=401, code=SESSION_EXPIRED | ✅ PASS |
| api.login | POST /api/auth/login（デモmanager） | 200 + token取得 | status=200, token=取得（値は非記録）, role=manager | ✅ PASS |
| api.runs400 | POST /api/sites/site-a/runs（task=invalid） | 400 INVALID_BODY（レコード作成なし） | status=400, code=INVALID_BODY | ✅ PASS |
| api.approvalsList | GET /api/approvals（先頭ID取得） | 200 + 1件以上のID（status=all） | 既定(クエリなし)=0件, pending=0件, approved=1件, rejected=0件, all=1件, firstId=4debba93-507e-4db0-b82d-4a6aca2abb7b | ✅ PASS |
| api.decision400 | POST /api/approvals/:id/decision（decision=invalid） | 400 INVALID_BODY（状態変更なし） | status=400, code=INVALID_BODY | ✅ PASS |
| api.decision404 | POST /api/approvals/AP-999999/decision（decision=approve） | 404 APPROVAL_NOT_FOUND | status=500, code=null, message=invalid input syntax for type uuid: "AP-999999" | ❌ FAIL |
| api.decision404body | 存在しないIDへのdecisionで内部エラー詳細を返さない（補足） | DBエラーコード(22P02)・SQLメッセージを含まない | code=22P02, message=invalid input syntax for type uuid: "AP-999999" | ❌ FAIL |
| api.getApproval404 | GET /api/approvals/AP-999999（読み取り・補足） | 404 APPROVAL_NOT_FOUND | status=500, code=null, message=invalid input syntax for type uuid: "AP-999999" | ❌ FAIL |
| api.auditVerify | GET /api/audit/verify | ok=true | status=200, ok=true, checked=55, head=738f605543e38fac | ✅ PASS |
| api.auditList | GET /api/audit?limit=5 | 200 + 最大5件 | status=200, count=5, lastSeq=51, lastType=LOGIN | ✅ PASS |
| api.systemInfo | GET /api/system/info | version/aiMode/ロール4行/メールなし | status=200, version=0.1.0, aiMode=demo-deterministic, roleRows=4, hasEmail=false | ✅ PASS |
| api.finalAuditVerify | GET /api/audit/verify（全操作後） | ok=true | ok=true, checked=55 | ✅ PASS |
| net.noWrites | ブラウザ操作中の書込みAPI呼び出し | POST /api/auth/login 以外の非GETなし（承認/却下/実行/ログアウトなし） | nonGET=1 (login=1, unexpected=0), targets=なし | ✅ PASS |
| console.knownOnly | console error（重複排除） | 既知の 401/404 のみ（ブート時の /api/auth/me 401・favicon等404） | unique=2, unknown=0, pageErrors=0 | ✅ PASS |
| shot.qa-preview-20261120-home.png | スクリーンショット qa-preview-20261120-home.png | PNGが保存され 1KB 以上 | 497631 bytes (docs/progress/evidence/qa-preview-20261120-home.png) | ✅ PASS |
| shot.qa-preview-20261120-audit.png | スクリーンショット qa-preview-20261120-audit.png | PNGが保存され 1KB 以上 | 329237 bytes (docs/progress/evidence/qa-preview-20261120-audit.png) | ✅ PASS |
| shot.qa-preview-20261120-settings.png | スクリーンショット qa-preview-20261120-settings.png | PNGが保存され 1KB 以上 | 376972 bytes (docs/progress/evidence/qa-preview-20261120-settings.png) | ✅ PASS |
| shot.qa-preview-20261120-viewer-3d.png | スクリーンショット qa-preview-20261120-viewer-3d.png | PNGが保存され 1KB 以上 | 932716 bytes (docs/progress/evidence/qa-preview-20261120-viewer-3d.png) | ✅ PASS |
| shot.qa-preview-20261120-role-field-nav.png | スクリーンショット qa-preview-20261120-role-field-nav.png | PNGが保存され 1KB 以上 | 930329 bytes (docs/progress/evidence/qa-preview-20261120-role-field-nav.png) | ✅ PASS |
| api.approvalsStatusCounts | GET /api/approvals?status=（all/pending/approved/rejected）の件数 | all = pending + approved + rejected | all=1, pending=0, approved=1, rejected=0, all.byStatus={"approved":1} | ✅ PASS |
| api.approvalsDefaultFilter | GET /api/approvals（クエリなし）の既定フィルタ | クエリなし件数 = pending 件数 | noQuery=0, pending=0 | ✅ PASS |
| ui.approvalsScreen.pending | 承認画面の「承認待ち」表示件数（pending） | pending=0件 | pendingCards=0, emptyText=承認待ちはありません | ✅ PASS |
| ui.approvalsScreen.history | 承認画面の「承認履歴」行数（decided） | 1行（all - pending） | historyRows=1, statusPills=承認 | ✅ PASS |
| ui.approvalsScreen.badge | ナビの承認バッジ（pending件数） | pending=0 のため非表示 | text=0, display=none | ✅ PASS |
| ui.approvalsScreen.page | 承認画面へ遷移できる | body[data-page]=approvals | data-page=approvals, heading=承認 ─ AIは下書きまで、確定は人 | ✅ PASS |
| ui.approvalsScreen.shot | 承認画面のスクリーンショット | PNGが保存され 1KB 以上 | 380772 bytes (docs/progress/evidence/qa-preview-20261120-approvals.png) | ✅ PASS |

## 2. API 契約（非破壊）

| エンドポイント | status | code / 値 | 備考 |
| --- | --- | --- | --- |
| GET /api/health | 200 | ok=true, db=up, version=0.1.0, aiMode=demo-deterministic, time=2026-11-20T05:16:52.830Z |  |
| OPTIONS /api/bootstrap | 204 | allow-origin=https://spatial-agent-studio-preview.pages.dev | allow-headers=content-type, authorization |
| GET /api/bootstrap（トークンなし） | 401 | UNAUTHENTICATED | ログインが必要です。 |
| GET /api/auth/me（不正トークン） | 401 | SESSION_EXPIRED | セッションが切れました。再ログインしてください。 |
| POST /api/auth/login（デモmanager） | 200 | token=取得, role=manager | 資格情報=env（値非記録） |
| POST /api/sites/site-a/runs（task=invalid） | 400 | INVALID_BODY | task は asbuilt または safety を指定してください。 |
| GET /api/approvals | 200 | pending=0, all=1, firstId=4debba93-507e-4db0-b82d-4a6aca2abb7b | IDのみ記録（既定はpendingフィルタ） |
| GET /api/approvals?status=（4種） | 200 | all=1, pending=0, approved=1, rejected=0, クエリなし=0 | トークンはUIのsessionStorageから再利用（追加ログインなし） |
| POST /api/approvals/:id/decision（decision=invalid） | 400 | INVALID_BODY | decision は approve または reject を指定してください。 |
| POST /api/approvals/AP-999999/decision（approve） | 500 | code=22P02 | message=invalid input syntax for type uuid: "AP-999999" |
| GET /api/approvals/AP-999999（補足・読み取り） | 500 | code= | message=invalid input syntax for type uuid: "AP-999999" |
| GET /api/audit/verify | 200 | ok=true, checked=55 | headHash先頭16=738f605543e38fac |
| GET /api/audit?limit=5 | 200 | count=5 | 末尾行 seq=51, type=LOGIN, actor=HUMAN:現場代理人・所長（デモ） |
| GET /api/system/info | 200 | version=0.1.0, aiMode=demo-deterministic | ロール行=4, メール様文字列=false |
| GET /api/audit/verify（全操作後） | 200 | ok=true, checked=55 | headHash先頭16=738f605543e38fac |

## 3. UI 起動（ログイン画面なし）

| 項目 | 実測 |
| --- | --- |
| #sasLogin 件数 / 表示 | 0 / false |
| body[data-page] | dash |
| #nav .nb 件数 | 11 |
| #sites .site 件数 | 5 |
| 現場名 | 3Dビュー対応 現場A ○○川 築堤・護岸工事 撮影 11/17 最新 進捗 100% / 3Dビュー対応 現場B △△橋 下部工 撮影 11/16 最新 進捗 55% / 3Dビュー対応 現場C □□トンネル 坑口部 撮影 11/15 最新 進捗 30% / 3Dビュー対応 現場D 国道△△号 法面補修工事 撮影 11/16 最新 進捗 78% / 3Dビュー対応 現場E 海岸堤防 嵩上げ工事 … |
| #bdgAccess | Access 未経由 |
| #roleName | 現場代理人・所長（デモ） |
| #roleBtn small | 承認者・管理者 |
| document.title | ○○川 築堤・護岸工事 ─ Spatial Agent Studio |

## 4. 11画面の実測

| data-pg | ロール | body[data-page] | 到達 | 見出し | KPI(.stat) | 表行 | 備考（トースト等） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dash | agent | dash | ○ | ホーム ─ 現場代理人・所長 | 0 | 0 | ホーム ─ 現場代理人・所長 全現場の「撮影 → 3DGS → AIチェック → 承認」を横断表示します（サンプルデータ＋このセッションの実行結果）。 現場Aを… |
| viewer | agent | viewer | ○ |  | 0 | 0 | AIがUIを自律操作中 Canvas2D（フォールバック） 10 fps ・ 10,906 splats 視点操作：ドラッグ回転 / 右ドラッグ移動 / ホイー… |
| pipeline | agent | viewer | × |  | 0 | 0 | 遷移不可: 「現場代理人・所長」ロールではこの画面を利用できません（Entra IDグループで制御・模擬） |
| data | agent | data | ○ | 3Dデータ基盤 ─ 同じ座標で重ねて、日付ごとに版管理 | 0 | 10 | 3Dデータ基盤 ─ 同じ座標で重ねて、日付ごとに版管理 3DGS・点群・設計データを同一座標系で統合し、撮影日ごとの「版」として保管します。版を並べると時間軸付… |
| approvals | agent | approvals | ○ | 承認 ─ AIは下書きまで、確定は人 | 0 | 1 | 承認 ─ AIは下書きまで、確定は人 AIの作成物（帳票・判定・停止指示）は、権限を持つ人が承認して初めて確定します。承認・却下はすべて監査ログに残ります。 A… |
| integration | agent | integration | ○ | 連携 ─ 通知・帳票・保存・原価・定期実行 | 0 | 0 | 連携 ─ 通知・帳票・保存・原価・定期実行 AIの結果をTeams通知、帳票出力、DirectCloud／SharePointへの保存、施工管理・原価システムへ… |
| governance | agent | integration | × |  | 0 | 0 | 遷移不可: |
| audit | agent | audit | ○ | 監査ログ ─ 追記専用・ハッシュ連鎖 | 4 | 53 | 監査ログ ─ 追記専用・ハッシュ連鎖 人の操作・AIの実行・承認・連携をすべて記録し、直前の記録のハッシュを含めて連鎖させます。1件でも書き換えると以降の検証が… |
| settings | agent | settings | ○ | システム設定 ─ 環境・権限・データ | 4 | 4 | システム設定 ─ 環境・権限・データ このプレビューの実行環境、Cloudflare Access の認証状態、付与ロール、データ件数、監査チェーンの状態を一覧… |
| arch | agent | arch | ○ | システム構成 ─ 7つの層 | 0 | 0 | システム構成 ─ 7つの層 層をクリックすると、役割・主な技術・このサンプルでの実装・本番での考慮点を表示します。 エージェントループ図 API連携イメージ 7… |
| roadmap | agent | roadmap | ○ | 導入計画・期待効果・注意点 | 1 | 0 | 導入計画・期待効果・注意点 小さく始めて、精度と運用を確かめながら広げます。期間・効果の数値は目安（サンプル）です。 導入ステップ いまここ Phase 0 構… |
| pipeline | it | pipeline | ○ | データ取得 ─ 撮影から3DGS生成まで | 7 | 3 | データ取得 ─ 撮影から3DGS生成まで ドローン・360°カメラ・地上LiDARの撮影データをGPUサーバで自動処理し、3DGSの「版」として3D基盤に登録し… |
| governance | it | governance | ○ | 統制 ─ AIゲートウェイ・ポリシー・監査 | 5 | 43 | 統制 ─ AIゲートウェイ・ポリシー・監査 IT・DX部門向け。APIキーはゲートウェイで保持し、ロール・操作の許可・人の承認・匿名化・費用・監査ログを一元管理… |

## 5. ロール切替（許可/ロック）

| ロール | 許可 | ロック | ロック対象 data-pg | #roleName 表示 |
| --- | --- | --- | --- | --- |
| agent | 9 | 2 | pipeline, governance | 現場代理人・所長（デモ） |
| hq | 9 | 2 | pipeline, governance | 本社（工務・安全・品質） |
| it | 11 | 0 | なし | IT・DX部門 |
| field | 7 | 4 | integration, governance, audit, settings | 現場担当者 |

ロールメニュー項目数: 4

### ロック画面への遷移試行（現場担当者 → audit）

- 遷移前: `viewer` → 遷移後: `viewer`（変化: false）
- トースト: 「現場担当者」ロールではこの画面を利用できません（Entra IDグループで制御・模擬）

## 6. 承認権限

| 項目 | 実測 |
| --- | --- |
| ROLE.cur | field |
| ROLE.defs.approve | {"field":false,"agent":true,"hq":false,"it":false} |
| #mApprove 表示状態 | false |
| #apYes.disabled | false |
| #apYes に disabled 属性 | false |
| #apRole 文言 | 承認者：現場代理人 |

> 判定: **UNVERIFIED** — #apYes は承認モーダル(#mApprove)内にあり disabled は updateApproveRole()（モーダル表示時）でしか更新されない。モーダルを開かない制約下では UI の disabled 表示は確定根拠にならないため、承認可否の根拠は ROLE.defs.approve（上記checks）に置く。

## 7. 監査ログUI

| 項目 | 実測 |
| --- | --- |
| 見出し | 監査ログ ─ 追記専用・ハッシュ連鎖 |
| KPI 数 / 内容 | 4 / 記録件数 53 / 直近24時間 53 / 種別 10 / ハッシュ連鎖 VERIFIED |
| ハッシュ連鎖表示 | VERIFIED（全件一致） 検証件数 53 件 HEADハッシュ b4ec8bdc83c50fba78cfa8746ddbe6d8eb90423270aad58b587eafb4f1f7c45d 検証方式 直前ハッシュ＋日時＋主体＋種別＋内容の SHA-256 連鎖 DB側は追記専用（UPDATE/DELETE をトリガで拒否）。改ざん検知はこの画面の再計算とサーバ検証の二段構えです。 |
| 一覧行数 / 件数表示 | 53 / 53 / 53 件 |
| 先頭行クリック詳細 | seq #53 日時 2026/11/20 14:14:50 主体 現場代理人・所長（デモ） 種別 LOGIN 内容 ログイン 前ハッシュ 00daefe7aef1441f844ea73af47709137eda585445d11f9058e4a48baceb0699 この記録のハッシュ b4ec8bdc83c50fba78cfa8746ddbe6d8eb90423270aad58b587eafb4f1f7c45d この記録を再計算して照合 前ハッシュ＋日時＋主体＋種別＋内容… |
| 再計算照合（#auRecheckRes） | 一致 — 改変されていません |
| 種別フィルタ | type=ACCESS_LOGIN, 10 / 53 件, rows=10 |
| 検索0件 | 0 / 53 件 / 条件に一致する記録がありません。 |

## 8. 承認画面（approvals）の実測

| 項目 | 実測 |
| --- | --- |
| data-page / 見出し | approvals / 承認 ─ AIは下書きまで、確定は人 |
| 承認待ち 表示件数（#apPend .apc） | 0（空表示: 承認待ちはありません） |
| 承認履歴 行数（#apHist tbody tr） | 1 |
| 承認履歴 列 | ID / 現場 / 件名 / 結果 / 承認者 / 日時 |
| 承認履歴の結果ピル | 承認 |
| 承認履歴 先頭行 | 4debba93-507e-4db0-b82d-4a6aca2abb7b ○○川 築堤・護岸工事 出来形管理帳票（ドラフト）を確定 承認 現場代理人・所長（デモ） 11/20 11:01 |
| 承認可否表示（#apWho） | あなた（現場代理人・所長）は承認できます |
| ナビの承認バッジ（#apBadge） | text=0, display=none |
| スクリーンショット | docs/progress/evidence/qa-preview-20261120-approvals.png（380772 bytes） |

API 側の件数（同一トークンで実測）:

| クエリ | status | 件数 | 内訳 |
| --- | --- | --- | --- |
| status=all | 200 | 1 | {"approved":1} |
| status=pending | 200 | 0 | — |
| status=approved | 200 | 1 | — |
| status=rejected | 200 | 0 | — |
| クエリなし（既定） | 200 | 0 | 既定は pending |

> 既定の `/api/approvals` が pending のみを返す実装（src/api/routes.ts）であるため、承認待ち0件時の空配列は仕様どおり。当初 FAIL としていた `api.approvalsList` は **テスト設計の不足**として PASS に再分類した（実装不具合ではない）。

## 9. システム設定UI

| 項目 | 実測 |
| --- | --- |
| バージョン | 0.1.0 |
| AIモード | demo-deterministic |
| DB | spatial_agent_studio_preview（接続中） |
| KPI | 稼働状態 稼働中 / バージョン 0.1.0 / 稼働時間 41分 52秒 / 監査連鎖 VERIFIED 53件 |
| Cloudflare Access 行 | 未経由（デモ） |
| Access割当 | 個別 1 件 / ドメイン 1 件 |
| セッション | 8 時間 |
| 件数表示 | {"sites":"5","users":"2","approvals":"1","reports":"1","auditEvents":"53","pending":"0"} |
| ロール表行数 | 4 |
| ロール表の内容 | 現場担当者 7 SG-現場A-施工管理 / 現場代理人・所長 9 SG-現場A-代理人 / 本社（工務・安全・品質） 9 SG-本社-工務安全品質 / IT・DX部門 11 SG-IT-DX-Admin |
| ハッシュ連鎖 | 一致（53件） |
| メール様文字列の露出 | false |
| ヘルスチェックのトースト | ヘルスチェック：API 正常 / DB up / v0.1.0 |

## 10. console error / 非GETリクエスト（書込み検知）

### console error（重複排除）

- `Failed to load resource: the server responded with a status of 404 ()` × 1（boot）
- `Failed to load resource: the server responded with a status of 401 ()` × 1（boot）

### pageerror: 0 件


### 非GETリクエスト（write検知）

| method | URL | status | 分類 | context |
| --- | --- | --- | --- | --- |
| POST | https://sas-api.mirai-dx-platform.com/api/auth/login | 200 | ALLOWED_AUTH_LOGIN | boot |

- 総非GET: 1 / auth.login: 1 / 想定外: 0
- 判定: **PASS（承認/却下/実行/ログアウトのAPI呼び出しなし）**

### HTTP 4xx/5xx 応答（参考）

- `GET 404 https://spatial-agent-studio-preview.pages.dev/cdn-cgi/access/get-identity` × 1（boot）
- `GET 401 https://sas-api.mirai-dx-platform.com/api/auth/me` × 1（boot）

## 11. スクリーンショット

| ファイル | bytes | 取得時刻（JST） |
| --- | --- | --- |
| docs/progress/evidence/qa-preview-20261120-home.png | 497631 | 2026/11/20 14:15:17 |
| docs/progress/evidence/qa-preview-20261120-audit.png | 329237 | 2026/11/20 14:15:52 |
| docs/progress/evidence/qa-preview-20261120-settings.png | 376972 | 2026/11/20 14:16:01 |
| docs/progress/evidence/qa-preview-20261120-viewer-3d.png | 932716 | 2026/11/20 14:16:08 |
| docs/progress/evidence/qa-preview-20261120-role-field-nav.png | 930329 | 2026/11/20 14:16:25 |

## 12. 期待との差分・注意

- ❌ api.decision404: 期待=404 APPROVAL_NOT_FOUND / 実測=status=500, code=null, message=invalid input syntax for type uuid: "AP-999999"
- ❌ api.decision404body: 期待=DBエラーコード(22P02)・SQLメッセージを含まない / 実測=code=22P02, message=invalid input syntax for type uuid: "AP-999999"
- ❌ api.getApproval404: 期待=404 APPROVAL_NOT_FOUND / 実測=status=500, code=null, message=invalid input syntax for type uuid: "AP-999999"
- ⚠️ approve.disabledContext: #apYes は承認モーダル(#mApprove)内にあり disabled は updateApproveRole()（モーダル表示時）でしか更新されない。モーダルを開かない制約下では UI の disabled 表示は確定根拠にならないため、承認可否の根拠は ROLE.defs.approve（上記checks）に置く。

### 再分類の記録（テスト設計の不足と実装不具合の区別）

- `api.approvalsList`: **PASS** — 再分類: GET /api/approvals の既定は status=pending（src/api/routes.ts）。承認待ち0件のため既定呼び出しが空配列になるのは実装どおりで、既存1件は approved（?status=all で実測）。当初の FAIL はタスク側の期待設定ミス（テスト設計の不足）であり、実装不具合ではない。

> AP-999999 への decision は「存在しないID=404」を期待したが実測は 500（DBエラーコード 22P02 が本文に露出）。これは実装側の契約差分として FAIL のまま残す。原因（ID列が uuid 型であること等）はコード/スキーマから推測できるが、本記録は観測事実のみを根拠とする。

## 13. 未確認・ギャップ（正直な記載）

- プレビュー配備コミットは画面/APIに露出していない（/api/health も /api/system/info も version=0.1.0 のみ）。リポジトリHEAD 0e4a8f7c と配備内容の一致は未確認。
- #apYes の disabled 表示は承認モーダル表示時にしか更新されないため、モーダルを開かない制約下では「UI上の承認不可」を直接実測できていない（ROLE.defs.approve の実測で代替）。
- 3Dビューの canvas は DOM 上存在するが、描画ピクセルの内容は画像目視でのみ確認可能（数値では検証していない）。
- staff権限の403は監査DENYが書かれるため本検証では実施していない（制約どおり）。
- API の 400/404 応答が DB へ副作用を残さないことはコード読解（スキーマ検証が先行）に基づく。DBを直接参照した確認は行っていない。

## 14. 禁止操作の遵守

- 承認・却下・実行・ログアウト・設定保存は実行していない（UI操作は画面遷移と読み取りのみ）。
- API は GET と、decision=invalid(400) / AP-999999+approve(404) / task=invalid(400) の非破壊確認のみ。
- 実在IDへの approve/reject、/api/sites/:id/runs の正当値、/api/auth/logout、staff権限403（監査DENY書込み）は未実施。
- トークン値・パスワードは記録していない。メールは記録時にマスクしている。

---

実測JSON: `docs/progress/evidence/qa-preview-20261120.json`

> 注: 本記録は「実測の事実」であり、リリース可否の判断は行っていません。判断はテスト責任者・リリース責任者が行います。
