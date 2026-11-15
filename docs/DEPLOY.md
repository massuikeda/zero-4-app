# Azure へのデプロイ（GitHub Actions）

`main` ブランチに変更が入ると、変わった側だけが自動でデプロイされます。

| 変更した場所 | workflow | デプロイ先 |
|---|---|---|
| `frontend/` | `.github/workflows/deploy-frontend.yml` | Azure App Service（Next.js） |
| `backend/` | `.github/workflows/deploy-backend.yml` | Azure App Service（FastAPI。テストが通ったときだけ） |

GitHub の Actions 画面から「Run workflow」で手動実行もできます。

```
ブラウザ ──> App Service（Next.js）──/api/*──> App Service（FastAPI）──> Azure Database for MySQL
```

## いまのログインについて（仮のログイン）

**いまは、ログイン画面でユーザーを選ぶだけの仮のログインです（パスワードなし）。** Entra ID（Microsoft アカウント）でのログインは、あとで機能追加として入れます。

- URLを知っている人は、誰でも、どのユーザーとしてでもログインできます。
- そのため、**本物の企業のデータは、ログインを入れるまで登録しないでください**（デモ用のデータだけにする）。
- URLは必要な人にだけ伝えてください。

Entra ID のログインに切り替えるとき（機能追加のあと）は、このページの末尾「Entra ID のログインに切り替えるとき」の設定を入れます。

## 1. Azure に用意するもの

| リソース | 設定 |
|---|---|
| App Service（フロントエンド用） | Linux・ランタイム **Node 22 LTS** |
| App Service（バックエンド用） | Linux・ランタイム **Python 3.11** |
| Azure Database for MySQL（フレキシブル サーバー・MySQL 8.0 以上） | App Service のディスクはデプロイのたびに入れ替わるため、SQLite（`flow.db`）は使えません。作り方は手順5 |

## 2. デプロイ用の「発行プロファイル」を取り出す

発行プロファイルは、App Service ごとのデプロイ用のID・パスワードが入ったファイルです。2つの App Service それぞれで行います。

1. App Service の「構成」→「全般設定」で **「SCM 基本認証の発行資格情報」をオン** にして保存する
   （App Service を作る画面の「デプロイ」タブで「基本認証」を有効にしておいても同じ）
2. App Service の「概要」→ 上のメニューの **「発行プロファイルのダウンロード」** を押す
3. ダウンロードしたファイルをメモ帳で開き、中身を全部コピーする（次の手順3で GitHub に貼る）

※ このファイルはパスワードと同じです。リポジトリに入れたり、チャットやメールに貼ったりしないでください。貼り終えたら削除して構いません。
※ 漏れたかもしれないときは、「概要」→「発行プロファイルのリセット」で無効にできます（そのあと取り出し直して GitHub に貼り直す）。

## 3. GitHub のリポジトリに入れる設定

Settings → Secrets and variables → Actions

**Secrets**

| 名前 | 値 |
|---|---|
| `AZURE_FRONTEND_PUBLISH_PROFILE` | フロントエンド用 App Service の発行プロファイルの中身（全部） |
| `AZURE_BACKEND_PUBLISH_PROFILE` | バックエンド用 App Service の発行プロファイルの中身（全部） |

**Variables**

| 名前 | 値 |
|---|---|
| `AZURE_FRONTEND_WEBAPP_NAME` | フロントエンド用 App Service の名前 |
| `AZURE_BACKEND_WEBAPP_NAME` | バックエンド用 App Service の名前 |


## 4. App Service（フロントエンド）の設定

「構成」→「全般設定」→ スタートアップ コマンド：

```
HOSTNAME=0.0.0.0 node server.js
```

「環境変数（アプリ設定）」：

| 名前 | 値 |
|---|---|
| `BACKEND_URL` | バックエンド用 App Service のURL（「概要」の「既定のドメイン」の先頭に `https://` を付けたもの。例：`https://zero4-app-be-xxxxxxxx.japaneast-01.azurewebsites.net`） |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false`（ビルド済みのものを送るので、Azure 側では作り直さない） |

※ `BACKEND_URL` は、フロントエンドが `/api/*` をバックエンドへ転送するときの転送先です。変えたときは保存するだけでよく（App Service が自動で再起動します）、デプロイし直す必要はありません。

## 5. App Service（バックエンド）の設定

「構成」→「全般設定」→ スタートアップ コマンド：

```
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

「環境変数（アプリ設定）」：

| 名前 | 値 |
|---|---|
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true`（デプロイのときに Azure 側で `requirements.txt` のパッケージを入れる） |
| `AUTH_MODE` | `dev`（仮のログイン） |
| `ALLOW_DEV_AUTH` | `true`（**必須**。仮のログインのまま Azure で動かすことを認める印。入っていないと起動しません） |
| `DB_BACKEND` | `mysql`（MySQL を使う印。これがないと SQLite のままになります） |
| `DB_HOST` | `<サーバー名>.mysql.database.azure.com` |
| `DB_USER` | MySQL の管理者ユーザー名 |
| `DB_PASSWORD` | MySQL のパスワード（記号が入っていても、そのまま書く） |
| `DB_NAME` | データベース名 |
| `SEED_DEMO` | `false`（データは `migrate_db.py` で移したものを使う） |
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_DEPLOYMENT` | 「AIでAS-ISを作成」を使う場合 |

**MySQL の用意**

1. Azure ポータルで「Azure Database for MySQL フレキシブル サーバー」を作る（MySQL 8.0 以上。管理者ユーザーとパスワードを決める）
2. サーバーの「データベース」で、空のデータベースを1つ作る（例：`flow`。文字セット `utf8mb4`）
3. サーバーの「ネットワーク」で「Azure 内の任意の Azure サービスにこのサーバーへのパブリック アクセスを許可する」にチェックを入れる（バックエンドの App Service からつなぐため）。自分のPCからSQLを実行するときは、自分のIPアドレスも追加する
4. バックエンド用 App Service のアプリ設定に、上の `DB_BACKEND`・`DB_HOST`・`DB_USER`・`DB_PASSWORD`・`DB_NAME` を入れる
   - 値は、ローカルの `backend/.env` に書いた `DB_HOST` などと同じ（`DB_BACKEND` だけは Azure 側にだけ入れる）
   - 接続は自動で暗号化（TLS）されます。サーバー側の「安全な転送を要求する」は有効のままにしてください
   - 1本のURLで入れたい場合は、代わりに `DATABASE_URL`（`mysql+pymysql://<ユーザー>:<パスワード>@<サーバー>:3306/<DB名>?charset=utf8mb4`）でも動きます

- テーブルは初回の起動時に自動で作られます。
- データは、ローカルで `python migrate_db.py` を実行して移します（`backend/.env` に `DB_HOST`・`DB_USER`・`DB_PASSWORD`・`DB_NAME` を書く。つながるかは `python check_db.py` で確かめられる）。

## うまくいかないとき

| 症状 | 確認するところ |
|---|---|
| workflow の「App Service にデプロイ」で失敗（401 や Publish profile のエラー） | 手順2の「SCM 基本認証の発行資格情報」がオンか、Secrets に発行プロファイルの中身を全部貼ったか、変数の App Service の名前が合っているか |
| フロントエンドが「Application Error」 | 手順4のスタートアップ コマンド。「ログ ストリーム」でエラーを確認 |
| 画面は出るが「サーバーに接続できませんでした」 | フロントエンドのアプリ設定 `BACKEND_URL`、バックエンドが起動しているか（`<BACKEND_URL>/api/health` を開くと `{"status":"ok"}` と出る） |
| バックエンドが起動しない | 手順5のスタートアップ コマンド・`SCM_DO_BUILD_DURING_DEPLOYMENT`・`ALLOW_DEV_AUTH`・`DB_BACKEND` と `DB_HOST` など。「ログ ストリーム」を確認 |

## Entra ID のログインに切り替えるとき（機能追加のあと）

| 場所 | 設定 |
|---|---|
| GitHub の Variables | `NEXT_PUBLIC_AUTH_MODE`=`entra`、`NEXT_PUBLIC_ENTRA_TENANT_ID`、`NEXT_PUBLIC_ENTRA_SPA_CLIENT_ID`、`NEXT_PUBLIC_ENTRA_API_SCOPE`（`api://<API用のID>/access_as_user`）→ フロントエンドを再デプロイ（これらはビルドのときに画面へ埋め込まれるため） |
| バックエンドのアプリ設定 | `AUTH_MODE`=`entra`、`ENTRA_TENANT_ID`、`ENTRA_API_CLIENT_ID` を入れ、`ALLOW_DEV_AUTH` を消す |
| Entra ID（SPA用のアプリ登録） | リダイレクトURIに `https://<フロントエンドのURL>/redirect` を追加 |
| DB | 最初の銀行担当者を1件登録：`INSERT INTO users (email, name, role) VALUES ('メールアドレス', '名前', 'admin');` |
