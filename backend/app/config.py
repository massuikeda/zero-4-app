"""設定（環境変数で上書きする。Azure では App Service の「環境変数」に設定）"""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

# SQLite ファイルの場所。Azure では /home/data/app.db など /home 配下にする（再起動で消えない）
DB_PATH = Path(os.getenv("DB_PATH", BACKEND_DIR / "data" / "app.db"))

SCHEMA_PATH = BACKEND_DIR / "db" / "schema.sql"

# DB が空のときにお試し用データを入れるか（本番では 0 にする）
SEED_DEMO = os.getenv("SEED_DEMO", "1") == "1"

# ログイントークンの署名鍵。本番では必ず長いランダム文字列を設定する
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me-please-32bytes!")
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

# フロントの URL（カンマ区切りで複数可）
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
