"""開発用のデモデータ（DBが空のときだけ投入）。部署名・回数・発言は架空の例。"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Business, Company, FlowDoc, Resource, User


def S(id_, lane, name, *, tool="", type_="作業", minutes=10, pc=False, manual=False, money=False,
      time="", error="", third=False, change=None, note="", nxt=(), media=(), labels=()):
    return {
        "id": id_, "lane": lane, "type": type_, "name": name, "tool": tool, "minutes": minutes,
        "pc": pc, "manual_input": manual, "money": money,
        # ボトルネック：時間がかかる理由／ミスの原因のどちらかがあれば印を付ける
        "issue": "ボトルネック" if (time or error) else None,
        "issue_time": time, "issue_error": error, "issue_detail": "", "third_party": third,
        "change": change, "note": note,
        "next": list(nxt), "next_media": list(media), "condition_labels": list(labels),
    }


ORDER_LANES = ["取引先", "営業部（受注）", "倉庫（出荷）"]

ORDER_ASIS = [
    S("S01", "取引先", "注文書を手書き", tool="手書き", minutes=10, nxt=["S02"], media=["FAX"]),
    S("S02", "営業部（受注）", "FAXを見て手入力", tool="Excel", pc=True, manual=True, minutes=15,
      time="手書きの文字を読み取りながら1件ずつ入力している", error="手書き文字の読み間違い",
      nxt=["S03"], media=["メール"]),
    S("S03", "倉庫（出荷）", "ピッキングリストを作成（加工）", tool="Excel", pc=True, manual=True, minutes=20,
      time="営業が入力した注文を、倉庫でもう一度エクセルに作り直している（二重入力）",
      error="作り直すときの写し間違い", nxt=["S04"]),
    S("S04", "倉庫（出荷）", "ピッキング", minutes=30,
      time="部署間の連絡がメール頼みで、確認待ちの時間がある", error="メールの見落とし",
      third=True, nxt=["S05", "S06"], media=["メール", ""]),
    S("S05", "営業部（受注）", "支払い（請求）情報を入力", tool="Excel", pc=True, manual=True, money=True, minutes=15,
      time="同じ情報を請求用の別のエクセルにも入力している（三重入力）", error="金額・数量の転記ミス", third=True),
    S("S06", "倉庫（出荷）", "出荷", minutes=20, nxt=["S07"], media=["配達"]),
    S("S07", "取引先", "受領を確認", tool="紙の伝票", minutes=5,
      time="紙の伝票を保管し、出荷記録と1枚ずつ照合している", error="伝票の紛失・照合漏れ", third=True),
]

ORDER_TOBE = [
    S("S01", "取引先", "Web受注フォームで注文", tool="受注システム", pc=True, minutes=5, change="簡素化",
      note="手書き・FAXをやめ、取引先がフォームに入力", nxt=["S02"], media=["システム連携"]),
    S("S02", "営業部（受注）", "注文内容を確認・確定", tool="受注システム", pc=True, minutes=5, change="自動化",
      note="FAXの手入力をなくし、確認だけにする", nxt=["S03"], media=["システム連携"]),
    S("S03", "倉庫（出荷）", "ピッキングリストを自動出力", tool="受注システム", pc=True, minutes=2, change="自動化",
      note="受注データからそのまま出力", nxt=["S04"]),
    S("S04", "倉庫（出荷）", "ピッキング", minutes=30, nxt=["S05", "S06"], media=["システム連携", ""]),
    S("S05", "営業部（受注）", "請求データを確認", tool="会計システム", pc=True, money=True, minutes=5, change="自動化",
      note="出荷実績から請求データを自動作成"),
    S("S06", "倉庫（出荷）", "出荷", minutes=20, nxt=["S07"], media=["配達"]),
    S("S07", "取引先", "受領を確認（電子）", tool="受注システム", pc=True, minutes=2, change="簡素化",
      note="電子の受領確認に切替え、紙の保管をなくす"),
]


def seed(db: Session) -> None:
    if db.scalar(select(User).limit(1)):
        return
    db.add(User(email="admin@example.com", name="管理者（あなた）", role="admin"))

    a = Company(name="株式会社サンプル商事", note="卸売業・従業員120名")
    for kind, names in {
        "部署": ["営業部（受注）", "倉庫（出荷）", "経理部"],
        "担当者": ["社員", "経理担当", "経理課長"],
        "取引先": ["取引先"],
        "システム": ["Excel", "Word", "受注システム", "会計システム"],
        "帳票": ["手書き", "紙の伝票", "請求書"],
    }.items():
        for i, n in enumerate(names):
            a.resources.append(Resource(kind=kind, name=n, sort=i))

    order = Business(
        name="受注〜出荷業務", department="営業部・倉庫", frequency="日30件",
        description="取引先からの注文を受け、出荷して受領を確認するまで",
        hearing_raw="受注〜出荷の流れについて営業の田中さん、倉庫の山本さんに聞いた。\n"
                    "取引先は注文書を手書きしてFAXで送ってくる。営業はFAXを見ながらエクセルに入力（1件15分くらい）。"
                    "字が読みにくくて読み間違えることがあるし、入力が大変。終わったらメールで倉庫に伝える。\n"
                    "倉庫はメールの内容をもう一回エクセルに打ち直してピッキングリストを作る（20分）。ピッキングは30分。"
                    "終わったら営業にメールで連絡して、確認が返ってくるまで待つことがある。\n"
                    "営業は請求のために別のエクセルにも支払い情報を入力（15分）。\n"
                    "倉庫は出荷して（20分）配達業者に渡す。取引先は紙の伝票で受領を確認（5分）。伝票は紙のまま保管。\n"
                    "注文は月末に集中する。",
        hearing_notes="取引先：注文書を手書きして送る →FAX\n"
                      "営業部：FAXを見てエクセルに手入力（15分） →メール\n"
                      "※ 手書きのFAXを見て手入力／読み間違い・入力の手間\n"
                      "倉庫：ピッキングリストをエクセルで作り直す（20分）\n"
                      "※ 同じ注文をエクセルで加工し直す／二重入力\n"
                      "倉庫：ピッキング（30分） →メール\n"
                      "※！ 部署間の連絡がメール頼み／見落とし・確認待ち\n"
                      "営業部：支払い（請求）情報をエクセルに入力（15分）\n"
                      "※！ 支払い情報も別のエクセルに入力／三重入力\n"
                      "倉庫：出荷（20分） →配達\n"
                      "取引先：紙の伝票で受領を確認（5分）\n"
                      "※！ 紙の伝票で受領を確認／保管・照合の手間\n"
                      "# 注文は月末に集中する",
        exec_view="受注から出荷まで、問題なく回っている",
        field_view="同じ注文を3回入力し、毎日残業で埋めている",
    )
    order.flows.append(FlowDoc(kind="asis", data={"lanes": ORDER_LANES, "steps": ORDER_ASIS}, updated_by="管理者（あなた）"))
    order.flows.append(FlowDoc(kind="tobe", data={"lanes": ORDER_LANES, "steps": ORDER_TOBE}, updated_by="管理者（あなた）"))

    inv = Business(
        name="請求書発行業務", department="経理部", frequency="月200件",
        description="出荷実績をもとに請求書を作成し、取引先へ送付する",
        hearing_notes="・会計システムへ手入力。転記ミスが月10件程度\n・課長不在時は承認が止まる\n・郵送が中心",
    )
    inv.flows.append(FlowDoc(kind="asis", updated_by="管理者（あなた）", data={
        "lanes": ["経理担当", "経理課長", "取引先"],
        "steps": [
            S("S01", "経理担当", "会計システムに手入力", tool="会計システム", pc=True, manual=True, minutes=30,
              time="エクセルの内容を会計システムに1件ずつ打ち直している", error="転記ミス（月10件程度）", nxt=["S02"]),
            S("S02", "経理担当", "請求書を印刷", tool="請求書", minutes=10, nxt=["S03"]),
            S("S03", "経理課長", "請求書を確認・承認", type_="判断", tool="請求書", minutes=10,
              nxt=["S04", "S01"], labels=["OK", "差戻し"]),
            S("S04", "経理課長", "承認待ち", type_="待ち", minutes=480,
              time="課長が不在だと承認が止まり、発行が1日以上遅れる", third=True, nxt=["S05"]),
            S("S05", "経理担当", "封入・郵送", tool="請求書", minutes=15, money=True, nxt=["S06"], media=["郵送"]),
            S("S06", "取引先", "請求書を受け取る", tool="請求書", minutes=0),
        ],
    }))
    expense = Business(
        name="経費精算業務", department="経理部", frequency="月150件",
        description="社員が立て替えた経費を精算する（AS-ISはまだ。ヒアリングボックスからAIでAS-ISを作る見本）",
        hearing_raw="経理の鈴木さんに聞いた。社員は立て替えた経費をエクセルの申請書に書いて、領収書と一緒に経理部に回してくる。"
                    "経理課長が中身を見て承認するが、課長が出張でいないと止まってしまう。"
                    "承認されたら経理担当が申請書を見ながら会計システムに入力していて、1件10分くらい。打ち間違いがたまにある。"
                    "振込は月末にまとめて経理担当がやる（全部で60分）。領収書の原本は紙で5年保管。",
    )
    a.businesses += [order, inv, expense]

    tanaka = User(email="tanaka@sample-shoji.example", name="田中（サンプル商事・営業）")
    suzuki = User(email="suzuki@sample-shoji.example", name="鈴木（サンプル商事・経理）")
    tanaka.businesses.append(order)
    suzuki.businesses.append(inv)
    a.users += [tanaka, suzuki]

    b = Company(name="山田製作所", note="製造業・従業員60名")
    for kind, n in [("部署", "製造部"), ("部署", "購買部"), ("取引先", "仕入先"), ("システム", "生産管理システム")]:
        b.resources.append(Resource(kind=kind, name=n))
    buy = Business(name="部品発注業務", department="購買部", frequency="週20件")
    b.businesses.append(buy)
    sato = User(email="sato@yamada-ss.example", name="佐藤（山田製作所・購買）")
    sato.businesses.append(buy)
    b.users.append(sato)

    db.add_all([a, b])
    db.commit()
