"""ユーザーのパスワードを設定する（いちばん最初の銀行担当者に使う。画面がまだ使えないため）。

使い方（backend フォルダで、仮想環境を有効にして実行）:
    python set_password.py <メールアドレス>                          … 登録済みのユーザーに設定する
    python set_password.py <メールアドレス> --create --name "山田 太郎"  … 銀行担当者を新しく作って設定する
    python set_password.py <メールアドレス> --mysql                    … Azure の MySQL に対して実行する
                                                                       （.env の DB_HOST などを使う）

パスワードは画面に表示されない入力欄で2回聞く（コマンドの引数には書かない。履歴に残るため）。
設定すると、ロック中でも解ける。企業の方のパスワードは、銀行担当者が画面（企業ユーザー）で決める。
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys


def main() -> int:
    ap = argparse.ArgumentParser(description="ユーザーのパスワードを設定する")
    ap.add_argument("email")
    ap.add_argument("--create", action="store_true", help="いなければ銀行担当者として作る")
    ap.add_argument("--name", default="", help="--create のときの名前")
    ap.add_argument("--mysql", action="store_true", help="Azure の MySQL（.env の DB_HOST など）に対して実行する")
    args = ap.parse_args()
    if args.mysql:
        os.environ["DB_BACKEND"] = "mysql"
        # .env に DATABASE_URL（ローカルの SQLite 用）が書いてあっても、そちらを使わず DB_HOST などでつなぐ
        os.environ["DATABASE_URL"] = ""
    os.environ.setdefault("SEED_DEMO", "false")

    from fastapi import HTTPException

    from app.auth import find_user, set_password
    from app.db import SessionLocal, User, init_db

    init_db()  # パスワードの列がまだなければ足す
    with SessionLocal() as db:
        print(f"接続先: {db.get_bind().dialect.name}")
        user = find_user(db, args.email)
        if not user:
            if not args.create:
                print(f"{args.email} は登録されていません（新しく作るときは --create --name を付けてください）")
                return 1
            if not args.name.strip():
                print("--create のときは --name で名前も指定してください")
                return 1
            user = User(email=args.email.strip(), name=args.name.strip(), role="admin")
            db.add(user)
        print(f"対象: {user.name}（{'銀行担当者' if user.role == 'admin' else '企業担当者'}・{user.email}）")
        pw = getpass.getpass("新しいパスワード（8文字以上）: ")
        if pw != getpass.getpass("もう一度: "):
            print("2回の入力が一致しません。設定していません")
            return 1
        try:
            set_password(user, pw)
        except HTTPException as e:
            print(e.detail)
            return 1
        db.commit()
    print("設定しました")
    return 0


if __name__ == "__main__":
    sys.exit(main())
