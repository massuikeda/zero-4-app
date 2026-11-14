# zero-4-app 業務フロー管理

企業ごとに業務の **AS-IS（現状）／TO-BE（改善後）** を決まったフォーマットで作成・管理するアプリです。

業務の流れは次のとおりです。

1. 現場でヒアリングし、「ヒアリング」タブに記録する（経営者の認識／現場の実態も）
2. AS-ISを決まったフォーマット（表）で入力する。図は自動で描かれる
3. TO-BEを「AS-ISをコピー」して修正する
4. 表を直接直して微修正する。図にはすぐ反映される
5. 「AS-IS／TO-BE／比較」をタブで切り替えて確認する

## 構成

| | 技術 |
|---|---|
| フロントエンド | Next.js 16（App Router）。図は自前の部品で描画 |
| バックエンド | Python（FastAPI）＋ SQLAlchemy |
| DB | 開発：SQLite（`backend/flow.db`）／本番：Azure Database for PostgreSQL など |
| 認証 | 開発：画面右上でユーザーを切り替え／本番：Entra ID |

`/api/*` へのリクエストは、Next.js が Python バックエンドへ転送します（`frontend/next.config.ts` の rewrites）。

## 権限

| 役割 | 見える範囲 | できること |
|---|---|---|
| 管理者 | すべての企業・業務 | 企業・リソース・業務・担当者の登録、担当者への業務の割り当て、フロー編集 |
| 担当者 | 自社の、割り当てられた業務だけ | ヒアリングメモ・AS-IS・TO-BEの閲覧と編集 |

- 権限はバックエンドで判定します。URLを直接打ち込んでも、割り当てのない業務や他社の業務は「見つかりません」になります。
- 2人が同じフローを同時に編集した場合、後から保存した人には「先に更新されています」と表示されます。黙って上書きされることはありません。

## 決まったフォーマット（業務フローの型）

すべての業務フローを、同じ型の図で描きます。

- **列＝担当**：部署・担当者・取引先。列の背景はすべてグレーです。
- **人のアイコン＋作業名**：上から順に並びます。配置は自動です。
- **画面アイコン**：PC作業。
- **色付きの札**：使っている道具。Excelは緑、Wordは青、会計システムなどのシステムはグレー、手書きはオレンジ、紙・伝票は茶色で表示します（「エクセル」と入力しても「Excel」と表示）。
- **矢印のラベル**：受け渡し手段（FAX・メール・配達・システム連携など）。
- **赤い作業名**：ボトルネック。作業を「ボトルネックにする」と作業名が赤くなり、右側の一覧に「作業名／時間がかかる理由／ミスの原因」の形で並びます。
- **¥**：お金の流れ。
- **右側のパネル**
  - AS-IS：ボトルネック一覧（作業名／時間がかかる理由／ミスの原因）、3つの集計、経営者の認識／現場の実態
  - TO-BE：改善ポイント（変更区分ごと）、3つの集計（AS-IS→TO-BE）、残っている課題
- **3つの集計**（固定）
  - 手入力・転記：作業名に「入力」「転記」「打ち込み」「書き写す」「作り直す」「加工」などが入っている作業の数（「自動」を含むものは除く）
  - メール連絡：受け渡し手段が「メール」の矢印の数
  - 紙：道具が手書き・紙・伝票・帳票の作業の数

TO-BEは「AS-ISをコピーして作成」から始めます。作業を削除すると「排除」、変えた作業には変更区分（統合・入替・簡素化・自動化・新規）を付けます。比較タブには、この差分と集計の変化が表示されます。

図は「画像で保存」でPNGに、「PDFで保存」でA4のPDFに出力できます（右側のボトルネック一覧・集計と、業務名・企業名・日付の見出しも入ります）。

型を変えるときに修正するファイル
- データの項目：`backend/app/schemas.py` と `frontend/lib/types.ts`
- 配置・集計・道具の色分け：`frontend/lib/flow.ts`
- 図の見た目：`frontend/components/FlowBoard.tsx`、`frontend/app/globals.css`

## ローカルでの起動

```bash
# 1) バックエンド
cd backend
python -m venv .venv
.venv\Scripts\activate            # Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env            # Mac/Linux: cp .env.example .env
uvicorn main:app --reload --port 8000

# 2) フロントエンド（別のターミナル）
cd frontend
npm install
copy .env.example .env.local      # Mac/Linux: cp .env.example .env.local
npm run dev
```

http://localhost:3000 を開きます。初回起動時にデモデータが入ります（2社・4業務・ユーザー4人。「受注〜出荷業務」は型の見本）。

- 画面右上の「開発用ユーザー」で、管理者と各社の担当者を切り替えられます。権限の違いを確認できます。
- デモデータを消して最初からやり直すときは、`backend/flow.db` を削除して再起動します。
- 本番では `SEED_DEMO=false` にしてください。

テストの実行：`pip install -r requirements-dev.txt` → `pytest -q`（backend フォルダで実行）

## Azure OpenAI（ヒアリングからAS-ISを作る）

ヒアリングタブの**ヒアリングボックス**に、現場で聞いた内容をそのまま書く・貼り付けて「AIでAS-ISを作成」を押すと、AS-ISの図ができあがります。

中では次の順に動きます（AIが作るのはテキストだけで、図は決まったルールで作ります）。

1. Azure OpenAI が、記録を下の決まった形式のテキストに直す（`backend/app/ai.py`）
2. そのテキストを決まったルールで読み取って図にする（`frontend/lib/hearing.ts`）
3. AS-ISがまだなければそのまま保存。すでにあれば確認のうえ作り直す（保存するまでは「元に戻す」で戻せる）

```
営業部：FAXを見てエクセルに手入力（15分） →メール
※ 手書きのFAXを見て手入力／読み間違い・入力の手間     … 現場の人が話した困りごと
※！ 部署間の連絡がメール頼み／見落とし・確認待ち       … 聞き手（第三者）が気づいた困りごと
# 注文は月末に集中する                                  … メモ（図には入らない）
```

AIが作ったテキストは業務の `hearing_notes` に保存されます（画面には出しません）。

**設定**（`backend/.env`。キーはブラウザには渡りません）

| 項目 | 内容 |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | Azure ポータル → Azure OpenAI リソース →「キーとエンドポイント」のエンドポイント |
| `AZURE_OPENAI_API_KEY` | 同じ画面の「キー1」 |
| `AZURE_OPENAI_DEPLOYMENT` | Azure AI Foundry で作った**デプロイ名**（モデル名ではありません） |
| `AZURE_OPENAI_API_VERSION` | 省略時 `2024-10-21` |

設定後、`pip install -r requirements.txt`（`openai` パッケージが入ります）→ バックエンドを再起動します。未設定でもアプリは動き、ボタンが押せないだけです。

- AIへの指示（形式のルールと見本）：`backend/app/ai.py` の `SYSTEM_PROMPT`・`EXAMPLE_INPUT`・`EXAMPLE_OUTPUT`
- API：`POST /api/businesses/{id}/hearing/format`（`{"raw": "…"}` → `{"text": "…"}`。保存はしません）

## 本番化（Azure）の流れ

1. **DB**：Azure Database for PostgreSQL を作成し、`DATABASE_URL` を設定します（`pip install psycopg[binary]` が必要）。
2. **Entra ID**：アプリ登録を2つ作ります。
   - API用：`api://<ID>` を公開し、スコープ `access_as_user` を追加します。
   - SPA用：プラットフォーム「シングルページアプリケーション」で、リダイレクトURIに `https://<ドメイン>/redirect` を登録します（開発時は `http://localhost:3000/redirect` も）。上記スコープへのアクセス許可も追加します。
     ※ ログインに使う MSAL Browser v5 では、戻り先が専用ページ `/redirect`（`frontend/app/redirect/page.tsx`）になります。このページにはCross-Origin-Opener-Policyヘッダーを付けないでください。
3. **企業の担当者**：Entra ID B2B のゲストとして招待します。担当者は自社のMicrosoftアカウントでログインできます。アプリ側では、同じメールアドレスで「担当者」を登録しておきます。
4. **設定**：
   - バックエンド：`AUTH_MODE=entra`、`ENTRA_TENANT_ID`、`ENTRA_API_CLIENT_ID`
   - フロント：`NEXT_PUBLIC_AUTH_MODE=entra` と Entra ID の各ID
5. **ホスティング**：App Service を2つ（Next.js 用、Python 用）用意するか、Container Apps にまとめます。フロント側の `BACKEND_URL` には、バックエンドのURLを設定します。

## フォルダ

```
backend/
  main.py              起動ファイル（uvicorn main:app）
  app/api.py           APIと権限チェック
  app/auth.py          ログインユーザーの特定・権限の判定
  app/db.py            テーブル定義（企業・リソース・ユーザー・業務・フロー・割り当て）
  app/schemas.py       フローのフォーマット
  app/render.py        比較指標（draw.io出力のAPIも残してあるが、画面からは使っていない）
  app/seed.py          デモデータ
  tests/               権限のテスト
frontend/
  app/page.tsx                 企業一覧（担当者は自社の業務一覧へ移動）
  app/companies/[id]/page.tsx  業務一覧・リソース・担当者
  app/businesses/[id]/page.tsx ヒアリング／AS-IS／TO-BE／比較 のタブ
  components/FlowBoard.tsx     決まった型の業務フロー図（右パネル含む）
  components/ComparisonView.tsx 比較タブ
  lib/flow.ts                  自動配置・集計・道具の分類
```
