"""データベース定義（SQLAlchemy）。

企業 ─┬─ リソース（部署・担当者・システム・帳票）
      ├─ ユーザー（企業の担当者）
      └─ 業務 ─┬─ フロー（AS-IS / TO-BE）
               └─ 割り当て（どの担当者が見られるか）
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON, Column, DateTime, ForeignKey, Integer, String, Table, Text, UniqueConstraint, create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import settings


def now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


assignments = Table(
    "assignments",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("business_id", ForeignKey("businesses.id", ondelete="CASCADE"), primary_key=True),
)


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    industry: Mapped[str] = mapped_column(String(100), default="")  # 業種
    employees: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 従業員数（未入力は空）
    hourly_wage: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 時給（円）。削減時間を金額に直すのに使う
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    resources: Mapped[list["Resource"]] = relationship(back_populates="company", cascade="all, delete-orphan")
    businesses: Mapped[list["Business"]] = relationship(back_populates="company", cascade="all, delete-orphan")
    users: Mapped[list["User"]] = relationship(back_populates="company", cascade="all, delete-orphan")


class Resource(Base):
    """企業ごとに決まったリソース。kind: 部署 / 担当者 / 取引先 / システム / 帳票"""

    __tablename__ = "resources"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(200))
    note: Mapped[str] = mapped_column(Text, default="")
    sort: Mapped[int] = mapped_column(Integer, default=0)

    company: Mapped[Company] = relationship(back_populates="resources")


class User(Base):
    """role: admin（すべて見られる） / member（自社の割り当てられた業務だけ）"""

    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="member")
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=True)
    # パスワードでのログイン（AUTH_MODE=password）。パスワードそのものは持たず、元に戻せない形（scrypt）だけを持つ
    password_hash: Mapped[str] = mapped_column(String(255), default="")
    failed_logins: Mapped[int] = mapped_column(default=0)  # 続けて間違えた回数
    locked_until: Mapped[datetime | None] = mapped_column(nullable=True)  # この時刻（UTC）までログインできない

    company: Mapped[Company | None] = relationship(back_populates="users")
    businesses: Mapped[list["Business"]] = relationship(secondary=assignments, back_populates="assignees")


class Business(Base):
    __tablename__ = "businesses"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    department: Mapped[str] = mapped_column(String(200), default="")
    frequency: Mapped[str] = mapped_column(String(100), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    hearing_raw: Mapped[str] = mapped_column(Text, default="")    # ヒアリングボックス（聞いたままの記録）
    hearing_notes: Mapped[str] = mapped_column(Text, default="")  # 決まった形式（ここからAS-ISを作る）
    exec_view: Mapped[str] = mapped_column(Text, default="")   # 経営者の認識
    field_view: Mapped[str] = mapped_column(Text, default="")  # 現場の実態
    adopted_plan: Mapped[str] = mapped_column(String(10), default="")  # 採用するTO-BEの案（ume / take / matsu。未選択は空）
    # 月の件数（費用対効果の計算に使う）。空なら、頻度の文字（「日30件」など）から画面側で換算する
    monthly_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    company: Mapped[Company] = relationship(back_populates="businesses")
    flows: Mapped[list["FlowDoc"]] = relationship(back_populates="business", cascade="all, delete-orphan")
    assignees: Mapped[list[User]] = relationship(secondary=assignments, back_populates="businesses")


class CostItem(Base):
    """単価表（全企業共通）。TO-BEの案で導入するもの（RPA・OCR など）の、初期費用と月額の目安。銀行担当者が編集する"""

    __tablename__ = "cost_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)
    initial_cost: Mapped[int] = mapped_column(Integer, default=0)  # 初期費用（円）
    monthly_cost: Mapped[int] = mapped_column(Integer, default=0)  # 月額（円）
    note: Mapped[str] = mapped_column(String(200), default="")
    sort: Mapped[int] = mapped_column(Integer, default=0)


# 単価表の最初の中身（表が空のときだけ入れる）。金額は仮の目安なので、銀行担当者が画面で直して使う
DEFAULT_COST_ITEMS: list[tuple[str, int, int, str]] = [
    # 名前, 初期費用, 月額, メモ
    ("RPA", 0, 150_000, "画面操作・転記の自動実行"),
    ("OCR", 0, 30_000, "紙・FAXの読み取り"),
    ("Webフォーム", 0, 5_000, "注文・申請の入力フォーム"),
    ("ワークフロー", 0, 20_000, "電子承認・スマホ承認"),
    ("ビジネスチャット", 0, 10_000, "社内の連絡"),
    ("クラウド型の業務サービス", 0, 30_000, "経費精算・請求書発行・受発注など"),
    ("電子帳票", 0, 10_000, "紙の伝票・帳票の電子化"),
    ("システム連携の設定", 500_000, 0, "API・CSVの自動取り込み"),
    ("EDI", 300_000, 30_000, "取引先との受発注データの交換"),
    ("バーコード", 200_000, 0, "読み取り機器と設定"),
]


class FlowDoc(Base):
    """業務フロー本体。data は schemas.Flow の JSON。version で同時編集の上書きを防ぐ。"""

    __tablename__ = "flows"
    __table_args__ = (UniqueConstraint("business_id", "kind"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    # asis / tobe_ume / tobe_take / tobe_matsu（松竹梅の3案）。以前の「tobe」（1案だけだったころ）の行は使わない
    kind: Mapped[str] = mapped_column(String(10))
    data: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_by: Mapped[str] = mapped_column(String(200), default="")

    business: Mapped[Business] = relationship(back_populates="flows")


def _engine_options(url: str) -> dict:
    """DBの種類ごとの接続設定"""
    if url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    if url.startswith("mysql"):
        opts: dict = {
            # Azure はしばらく使っていない接続を切るので、使う前に確かめ、古い接続は作り直す
            "pool_pre_ping": True,
            "pool_recycle": 280,
        }
        if settings.db_ssl:
            # Azure Database for MySQL は暗号化（TLS）した接続だけを受け付ける。証明書も確認する
            import ssl

            opts["connect_args"] = {"ssl": ssl.create_default_context()}
        return opts
    return {"pool_pre_ping": True}


engine = create_engine(settings.database_url, **_engine_options(settings.database_url))

if settings.database_url.startswith("sqlite"):
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):  # SQLiteで外部キー（CASCADE）を有効化
        dbapi_conn.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# あとから増やした列（既存のDBには無いので、起動時に足す）
_ADDED_COLUMNS = [
    ("businesses", "hearing_raw", "TEXT NOT NULL DEFAULT ''"),
    ("companies", "industry", "VARCHAR(100) NOT NULL DEFAULT ''"),
    ("companies", "employees", "INTEGER"),
    ("businesses", "adopted_plan", "VARCHAR(10) NOT NULL DEFAULT ''"),
    ("companies", "hourly_wage", "INTEGER"),
    ("businesses", "monthly_count", "INTEGER"),
    ("users", "password_hash", "VARCHAR(255) NOT NULL DEFAULT ''"),
    ("users", "failed_logins", "INTEGER NOT NULL DEFAULT 0"),
    ("users", "locked_until", "DATETIME NULL"),
]


def init_db():
    Base.metadata.create_all(engine)
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    with engine.begin() as conn:
        for table, col, ddl in _ADDED_COLUMNS:
            if col not in {c["name"] for c in insp.get_columns(table)}:
                if engine.dialect.name == "mysql":
                    ddl = ddl.replace("DEFAULT ''", "DEFAULT ('')")  # MySQL は TEXT の初期値をかっこで書く
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
        _move_company_note(conn)
        _fill_cost_items(conn)


def _fill_cost_items(conn) -> None:
    """単価表が空なら、最初の中身を入れる（1件でもあれば何もしない。消したものを勝手に戻さない）"""
    from sqlalchemy import func, insert, select

    table = CostItem.__table__
    if conn.scalar(select(func.count()).select_from(table)):
        return
    conn.execute(insert(table), [
        {"name": n, "initial_cost": i, "monthly_cost": m, "note": note, "sort": k}
        for k, (n, i, m, note) in enumerate(DEFAULT_COST_ITEMS)
    ])


def _move_company_note(conn) -> None:
    """業種・従業員数の列ができる前は、メモに「卸売業・従業員120名」の形で書いていた。
    業種・従業員数がどちらも空で、メモがその形の企業だけ、業種・従業員数へ移す（形が違うメモはそのまま残す）"""
    import re

    from sqlalchemy import text

    pat = re.compile(r"^\s*(?P<ind>[^・]+?)\s*・\s*従業員\s*(?P<num>[\d,]+)\s*名\s*$")
    for cid, note in conn.execute(text("SELECT id, note FROM companies WHERE industry = '' AND employees IS NULL")).all():
        m = pat.match(note or "")
        if m:
            conn.execute(
                text("UPDATE companies SET industry = :i, employees = :e, note = '' WHERE id = :id"),
                {"i": m["ind"], "e": int(m["num"].replace(",", "")), "id": cid},
            )
