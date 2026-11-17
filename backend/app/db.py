"""データベース定義（SQLAlchemy）。

企業 ─┬─ リソース（部署・担当者・システム・帳票）
      ├─ ユーザー（企業の担当者）
      ├─ 業務 ─┬─ フロー（AS-IS / TO-BE。いまの状態）
      │        └─ 割り当て（どの担当者が見られるか）
      │        ├─ AS-ISの版（保存するたびに1つ残る）
      └─ 診断の記録（年次DX診断・改善提案）─ そのときのAS-ISの版（業務ごとに選ぶ）
"""
from __future__ import annotations

from datetime import datetime, timezone

from datetime import date as date_

from sqlalchemy import (
    JSON, Column, Date, DateTime, Float, ForeignKey, Integer, String, Table, Text, UniqueConstraint, create_engine,
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
    diagnoses: Mapped[list["Diagnosis"]] = relationship(back_populates="company", cascade="all, delete-orphan")


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
    # 松竹梅の3案だったころの「採用する案」。TO-BEを1つにしたので、今は使っていない（列は残してある）
    adopted_plan: Mapped[str] = mapped_column(String(10), default="")
    # 月の件数（月の削減額の計算に使う）。空なら、頻度の文字（「日30件」など）から画面側で換算する
    monthly_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    company: Mapped[Company] = relationship(back_populates="businesses")
    flows: Mapped[list["FlowDoc"]] = relationship(back_populates="business", cascade="all, delete-orphan")
    versions: Mapped[list["FlowVersion"]] = relationship(back_populates="business", cascade="all, delete-orphan")  # AS-ISの版
    assignees: Mapped[list[User]] = relationship(secondary=assignments, back_populates="businesses")


class FlowDoc(Base):
    """業務フロー本体。data は schemas.Flow の JSON。version で同時編集の上書きを防ぐ。"""

    __tablename__ = "flows"
    __table_args__ = (UniqueConstraint("business_id", "kind"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    # asis（現状）/ tobe_matsu（改善後）。TO-BEは1つだけ（松竹梅の3案をやめて、松だけを残した。値の名前はそのまま）。
    # tobe_ume・tobe_take と、さらに前の「tobe」の行は使わない（残っていても画面には出ない）
    kind: Mapped[str] = mapped_column(String(10))
    data: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_by: Mapped[str] = mapped_column(String(200), default="")

    business: Mapped[Business] = relationship(back_populates="flows")


# FlowDoc.kind に入れる値
ASIS_KIND = "asis"
TOBE_KIND = "tobe_matsu"


class FlowVersion(Base):
    """AS-ISの版。AS-ISを保存するたびに、その時点の中身を1つ残す（あとから書き換えない）。
    number は業務ごとの通し番号（第1版・第2版…）。過去のAS-ISをさかのぼって見るのに使う"""

    __tablename__ = "flow_versions"
    __table_args__ = (UniqueConstraint("business_id", "number"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)  # schemas.Flow の JSON
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    saved_by: Mapped[str] = mapped_column(String(200), default="")
    # 削減工数（月あたり・時間）を手で入力した値。空なら、第1版との作業時間の差から自動で出す（effort.py）
    saved_hours: Mapped[float | None] = mapped_column(Float, nullable=True)

    business: Mapped[Business] = relationship(back_populates="versions")
    links: Mapped[list["DiagnosisFlow"]] = relationship(back_populates="version", cascade="all, delete-orphan")


class Diagnosis(Base):
    """診断の記録（企業ごとの履歴の1件）。kind: annual（年次DX診断）/ proposal（改善提案）。
    記録するときに、業務ごとに「そのときのAS-ISはどの版か」を選ぶ（DiagnosisFlow）"""

    __tablename__ = "diagnoses"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    date: Mapped[date_] = mapped_column(Date)                         # 実施日
    kind: Mapped[str] = mapped_column(String(20), default="annual")
    participants: Mapped[str] = mapped_column(String(300), default="")  # 参加者（経営者、受注課、倉庫 など）
    staff: Mapped[str] = mapped_column(String(200), default="")         # 銀行側の担当（DX支援部門 田中／営業店 佐藤 など）
    note: Mapped[str] = mapped_column(Text, default="")                 # 内容（提案したこと・決まったこと）
    # 経営者の見立てと現場の実態のずれ。[{"exec": "経営者の見立て", "field": "現場の実態"}, …]
    gaps: Mapped[list] = mapped_column(JSON, default=list)
    created_by: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

    company: Mapped[Company] = relationship(back_populates="diagnoses")
    flows: Mapped[list["DiagnosisFlow"]] = relationship(back_populates="diagnosis", cascade="all, delete-orphan")


class DiagnosisFlow(Base):
    """診断の記録と、AS-ISの版の結び付き。1つの記録で、1つの業務につき選べる版は1つ"""

    __tablename__ = "diagnosis_flows"
    __table_args__ = (UniqueConstraint("diagnosis_id", "business_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    diagnosis_id: Mapped[int] = mapped_column(ForeignKey("diagnoses.id", ondelete="CASCADE"), index=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("flow_versions.id", ondelete="CASCADE"), index=True)

    diagnosis: Mapped[Diagnosis] = relationship(back_populates="flows")
    version: Mapped[FlowVersion] = relationship(back_populates="links")


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
    ("flow_versions", "saved_hours", "FLOAT NULL"),
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
        _first_versions(conn)
        if "flow_snapshots" in insp.get_table_names():
            _link_old_snapshots(conn)


def _first_versions(conn) -> None:
    """版を残す仕組みができる前に保存されたAS-ISを、その業務の第1版として残す（版がまだ1つもない業務だけ）"""
    from sqlalchemy import insert, select

    flows, versions = FlowDoc.__table__, FlowVersion.__table__
    have = set(conn.scalars(select(versions.c.business_id).distinct()))
    rows = conn.execute(select(flows.c.business_id, flows.c.data, flows.c.updated_at, flows.c.updated_by)
                        .where(flows.c.kind == ASIS_KIND)).all()
    new = [{"business_id": bid, "number": 1, "data": data, "saved_at": at or now(), "saved_by": by or ""}
           for bid, data, at, by in rows if bid not in have and (data or {}).get("steps")]
    if new:
        conn.execute(insert(versions), new)


def _link_old_snapshots(conn) -> None:
    """版を「診断を記録したときの写し」（flow_snapshots）として持っていたころの記録を、今の形につなぎ直す。
    写しと中身が同じ版があれば、その版を「その診断で選んだ版」にする（同じ版がなければ何もしない）。
    flow_snapshots は読むだけで、書き換えない"""
    import json

    from sqlalchemy import insert, select, text

    versions, links = FlowVersion.__table__, DiagnosisFlow.__table__
    linked = set(conn.execute(select(links.c.diagnosis_id, links.c.business_id)).all())
    for did, bid, raw in conn.execute(text("SELECT diagnosis_id, business_id, data FROM flow_snapshots")).all():
        if (did, bid) in linked:
            continue
        try:
            snap = json.loads(raw) if isinstance(raw, (str, bytes)) else raw
        except ValueError:
            continue
        for vid, data in conn.execute(select(versions.c.id, versions.c.data).where(versions.c.business_id == bid)
                                      .order_by(versions.c.number.desc())).all():
            if data == snap:
                conn.execute(insert(links), {"diagnosis_id": did, "business_id": bid, "version_id": vid})
                break


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
