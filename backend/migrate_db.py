"""SQLite（flow.db）のデータを Azure Database for MySQL へ移す。

使い方（backend フォルダで、仮想環境を有効にして実行）:
    pip install -r requirements.txt
    python migrate_db.py

接続先は backend/.env に書く（このファイルには書かない）:
    DB_HOST=<サーバー名>.mysql.database.azure.com
    DB_USER=<管理者ユーザー>
    DB_PASSWORD=<パスワード>          … 記号が入っていてもそのまま書いてよい
    DB_NAME=<データベース名>           … Azure ポータルで先に作っておく（空でよい）
    DB_PORT=3306                       … 省略可
    DB_SSL=true                        … 省略可（Azure は暗号化が必須。手元の MySQL で試すときだけ false）

やること:
  1. MySQL にテーブルを作る（すでにあれば何もしない）
  2. flow.db の全テーブルを、IDもそのままコピーする
  3. 件数を SQLite と MySQL で並べて表示する
何度実行しても大丈夫（すでに入っている行は飛ばす）。flow.db は読むだけで、書き換えない。
"""
from __future__ import annotations

import os
import ssl
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import URL, Engine, create_engine, func, insert, select

load_dotenv()

from app.db import Base  # noqa: E402  テーブル定義（アプリと同じもの）

SQLITE_PATH = Path(__file__).parent / "flow.db"


def mysql_engine() -> Engine:
    missing = [k for k in ("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME") if not os.getenv(k)]
    if missing:
        sys.exit(f"backend/.env に {'・'.join(missing)} がありません（このファイルの先頭の説明を参照）")
    url = URL.create(
        "mysql+pymysql",
        username=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        host=os.environ["DB_HOST"],
        port=int(os.getenv("DB_PORT", "3306")),
        database=os.environ["DB_NAME"],
        query={"charset": "utf8mb4"},
    )
    use_ssl = os.getenv("DB_SSL", "true").lower() in ("1", "true", "yes")
    connect_args = {"ssl": ssl.create_default_context()} if use_ssl else {}
    return create_engine(url, connect_args=connect_args)


def copy_all(src: Engine, dst: Engine) -> list[tuple[str, int, int, int]]:
    """全テーブルをコピーする。戻り値: (テーブル名, 移行元の件数, 今回入れた件数, 移行先の件数)"""
    Base.metadata.create_all(dst)
    result = []
    # sorted_tables … 親（企業）→ 子（業務・フロー）の順。外部キーの順番を守る
    with src.connect() as s, dst.begin() as d:
        for table in Base.metadata.sorted_tables:
            rows = [dict(r._mapping) for r in s.execute(select(table))]
            before = d.scalar(select(func.count()).select_from(table))
            if rows:
                # すでにある行（同じID・同じメールアドレス）は飛ばす
                stmt = insert(table).prefix_with("IGNORE", dialect="mysql").prefix_with("OR IGNORE", dialect="sqlite")
                d.execute(stmt, rows)
            after = d.scalar(select(func.count()).select_from(table))
            result.append((table.name, len(rows), after - before, after))
    return result


def main() -> None:
    if not SQLITE_PATH.exists():
        sys.exit(f"{SQLITE_PATH} が見つかりません")
    src = create_engine(f"sqlite:///{SQLITE_PATH}")
    dst = mysql_engine()
    print(f"移行元: {SQLITE_PATH.name}  →  移行先: MySQL（{os.environ['DB_HOST']} / {os.environ['DB_NAME']}）")
    try:
        result = copy_all(src, dst)
    except Exception as e:  # noqa: BLE001  接続の失敗などを分かる言葉で出す
        sys.exit(f"移行に失敗しました（何も書き込まれていません）: {type(e).__name__}: {e}")
    print(f"{'テーブル':<14}{'SQLite':>8}{'今回追加':>8}{'MySQL':>8}")
    ok = True
    for name, n_src, added, n_dst in result:
        mark = "" if n_dst >= n_src else "  ← 件数が足りません"
        ok = ok and n_dst >= n_src
        print(f"{name:<16}{n_src:>8}{added:>10}{n_dst:>9}{mark}")
    print("移行完了" if ok else "件数が合わないテーブルがあります。上の表を確認してください")


if __name__ == "__main__":
    main()
