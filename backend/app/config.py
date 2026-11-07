"""設定（環境変数で上書きする。Azure では App Service の「環境変数」に設定）"""

import logging
import os
from pathlib import Path

log = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent.parent

# 本番かどうか
#   ・Azure App Service では WEBSITE_SITE_NAME が自動で入るので、それで判定する
#   ・それ以外の本番環境では APP_ENV=production を設定する
IS_PRODUCTION = bool(os.getenv("WEBSITE_SITE_NAME")) or os.getenv("APP_ENV") == "production"

# SQLite ファイルの場所。Azure では /home/data/app.db など /home 配下にする（再起動で消えない）
DB_PATH = Path(os.getenv("DB_PATH", BACKEND_DIR / "data" / "app.db"))

SCHEMA_PATH = BACKEND_DIR / "db" / "schema.sql"

# DB を新しく作るときにお試し用データを入れるか
#   設定しなければ「入れない」。ローカルで試すときだけ SEED_DEMO=1 を付けて起動する
SEED_DEMO = os.getenv("SEED_DEMO", "0") == "1"

# ログイントークンの署名鍵
#   本番では必ず環境変数で設定する（未設定・短すぎる場合は起動を止める）
#   作り方の例: python -c "import secrets; print(secrets.token_urlsafe(48))"
_DEV_JWT_SECRET = "dev-only-secret-do-not-use-in-production"
JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    if IS_PRODUCTION:
        raise RuntimeError("JWT_SECRET が設定されていません。App Service の環境変数に長いランダム文字列を設定してください。")
    JWT_SECRET = _DEV_JWT_SECRET
    log.warning("JWT_SECRET が未設定のため開発用の値を使います（本番では必ず設定してください）")
elif IS_PRODUCTION and len(JWT_SECRET) < 32:
    raise RuntimeError("JWT_SECRET が短すぎます。32文字以上のランダム文字列を設定してください。")

JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

# フロントの URL（カンマ区切りで複数可）
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
