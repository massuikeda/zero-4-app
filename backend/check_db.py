"""Azure Database for MySQL につながるかを確かめる（読むだけ。何も書き込まない）。

使い方（backend フォルダで、仮想環境を有効にして実行）:  python check_db.py
接続先は backend/.env の DB_HOST・DB_USER・DB_PASSWORD・DB_NAME を使う（値は画面に出さない）。
"""
from __future__ import annotations

import os
import sys

from sqlalchemy import inspect, text

from migrate_db import mysql_engine  # 移行スクリプトと同じつなぎ方を使う


def main() -> None:
    engine = mysql_engine()
    print(f"接続先: {os.environ['DB_HOST']} / {os.environ['DB_NAME']}")
    try:
        with engine.connect() as conn:
            version = conn.scalar(text("SELECT VERSION()"))
            charset, collation = conn.execute(
                text("SELECT @@character_set_database, @@collation_database")
            ).one()
            cipher = conn.execute(text("SHOW STATUS LIKE 'Ssl_cipher'")).one()[1]
            tables = inspect(conn).get_table_names()
    except Exception as e:  # noqa: BLE001
        print(f"× つながりませんでした: {type(e).__name__}: {e}")
        msg = str(e)
        if "1045" in msg:
            print("→ ユーザー名かパスワードが違います（.env の DB_USER・DB_PASSWORD）")
        elif "1049" in msg:
            print("→ データベースが見つかりません（.env の DB_NAME。Azure ポータルの「データベース」の名前と同じか）")
        elif "2003" in msg or "timed out" in msg.lower():
            print("→ サーバーに届いていません。Azure ポータルの「ネットワーク」で自分のPCのIPアドレスを許可しているか、"
                  "DB_HOST のつづりを確認してください")
        elif "getaddrinfo" in msg or "Name or service not known" in msg:
            print("→ サーバー名が見つかりません（.env の DB_HOST のつづり）")
        sys.exit(1)

    print("○ つながりました")
    print(f"  MySQL のバージョン: {version}")
    print(f"  文字セット / 照合順序: {charset} / {collation}" + ("" if charset == "utf8mb4" else "  ← utf8mb4 にしてください"))
    print(f"  暗号化（TLS）: {'有効（' + cipher + '）' if cipher else '無効'}")
    print(f"  テーブル: {'、'.join(tables) if tables else 'まだありません（python migrate_db.py で作られます）'}")


if __name__ == "__main__":
    main()
