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
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    company: Mapped[Company] = relationship(back_populates="businesses")
    flows: Mapped[list["FlowDoc"]] = relationship(back_populates="business", cascade="all, delete-orphan")
    assignees: Mapped[list[User]] = relationship(secondary=assignments, back_populates="businesses")


class FlowDoc(Base):
    """業務フロー本体。data は schemas.Flow の JSON。version で同時編集の上書きを防ぐ。"""

    __tablename__ = "flows"
    __table_args__ = (UniqueConstraint("business_id", "kind"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # asis / tobe
    data: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_by: Mapped[str] = mapped_column(String(200), default="")

    business: Mapped[Business] = relationship(back_populates="flows")


_connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=_connect_args)

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
_ADDED_COLUMNS = [("businesses", "hearing_raw", "TEXT NOT NULL DEFAULT ''")]


def init_db():
    Base.metadata.create_all(engine)
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    with engine.begin() as conn:
        for table, col, ddl in _ADDED_COLUMNS:
            if col not in {c["name"] for c in insp.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
