"""zero-4-app バックエンド（FastAPI）

ローカル起動（backend フォルダで）:
    uvicorn main:app --reload
    → http://localhost:8000/docs で API を試せる

Azure App Service の起動コマンド:
    gunicorn -w 1 -k uvicorn.workers.UvicornWorker main:app
    （SQLite を使う間はワーカー1つ・インスタンス1台にする）
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.db import init_db
from app.routers import common, company, talent


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()  # テーブルがなければ作る
    yield


app = FastAPI(title="Zero-4 マッチング API", lifespan=lifespan)

# フロント（Next.js）からの呼び出しを許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(common.router)
app.include_router(company.router)
app.include_router(talent.router)
