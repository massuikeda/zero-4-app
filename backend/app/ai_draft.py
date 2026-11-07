"""AI 要約・要件化

今はルールで下書きを組み立てる仮実装。
LLM（Azure OpenAI など）につなぐときは generate_draft() の中身だけを差し替える。
"""

import sqlite3

from app.schemas import AiDraft

# 課題のチェック項目 → 必要そうなスキル（issue_options.id → skills.id）
SKILL_HINTS: dict[int, list[int]] = {
    1: [3, 2],  # 紙・Excel → kintone, Excel
    2: [8, 2],  # 同じ入力 → RPA, Excel
    3: [4, 6],  # 新規顧客 → SNS運用, Webサイト制作
    4: [4, 5],  # SNS → SNS運用, Instagram
    5: [6],     # ホームページ → Webサイト制作
    6: [7, 1],  # 売上データ → データ分析, Python
}


def generate_draft(db: sqlite3.Connection, issue_ids: list[int], free_text: str) -> AiDraft:
    options = []
    if issue_ids:
        marks = ",".join("?" * len(issue_ids))
        options = db.execute(
            f"SELECT id, category, label FROM issue_options WHERE id IN ({marks}) ORDER BY sort_order", issue_ids
        ).fetchall()
    labels = [o["label"] for o in options]
    categories = list(dict.fromkeys(o["category"] for o in options))
    skill_ids = list(dict.fromkeys(s for i in issue_ids for s in SKILL_HINTS.get(i, [])))
    skill_names = [r["name"] for sid in skill_ids for r in db.execute("SELECT name FROM skills WHERE id = ?", (sid,))]

    main = categories[0] if categories else "業務改善"
    joined = "、".join(labels) or "現状の課題"
    summary = f"{joined}という状況です。"
    if free_text.strip():
        summary += f"具体的には「{free_text.strip()[:80]}」とのことで、"
    summary += f"{main}の取り組みが必要と考えられます。"

    return AiDraft(
        summary=summary,
        requirements=f"{'・'.join(skill_names) or 'IT全般'}の実務経験がある方。"
        "月10時間程度で、現場へのヒアリングから小さく始めて改善を進められる方。",
        title=f"{main}を一緒に進めてくれる方を募集",
        description=f"{'、'.join(labels) or '社内の課題'}を解決したいと考えています。"
        "隔週の定例で進め方を相談しながら、3か月で成果が見える形を目指します。",
        skill_ids=skill_ids,
    )
