"""
TF-IDF による 案件 ⇔ 人材 マッチング

・案件の文書  = 公開タイトル + 公開説明 + AI要件 + 求めるスキル + 課題のチェック項目
・人材の文書  = 自己紹介 + 本業 + スキル + 公開してよい実績
・両方を同じ語彙で TF-IDF ベクトル化し、コサイン類似度でスコア化（0〜1）

注意
・人材に見せる側の案件文書には企業名・ai_summary（企業の生の課題）を入れない
・日本語は Janome（純Python・追加インストール不要）で分かち書きする
"""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

from janome.tokenizer import Tokenizer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# スキル名は重要なので文書内で繰り返して重みを上げる
SKILL_WEIGHT = 3

# 意味の薄い語
STOPWORDS = {
    "する", "ある", "いる", "なる", "できる", "こと", "もの", "ため", "よう", "これ", "それ",
    "さん", "など", "また", "及び", "ます", "です", "月", "時間", "対応", "業務", "支援",
}

# 品詞：名詞・動詞・形容詞だけ使う（助詞・記号などは捨てる）
_KEEP_POS = ("名詞", "動詞", "形容詞")
_DROP_NOUN_SUB = ("数", "非自立", "代名詞", "接尾")


@lru_cache(maxsize=1)
def _tokenizer() -> Tokenizer:
    # Tokenizer の生成は重いので1回だけ
    return Tokenizer()


def normalize(text: str) -> str:
    """全角英数→半角、英字は小文字（'ＡＷＳ' と 'aws' を同じ語にする）"""
    return unicodedata.normalize("NFKC", text or "").lower()


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for t in _tokenizer().tokenize(normalize(text)):
        pos = t.part_of_speech.split(",")
        if pos[0] not in _KEEP_POS:
            continue
        if pos[0] == "名詞" and pos[1] in _DROP_NOUN_SUB:
            continue
        word = t.base_form if t.base_form != "*" else t.surface
        if len(word) < 2 and not re.match(r"[a-z]", word):  # 1文字のひらがな等は捨てる（'r','c'は残す）
            continue
        if word in STOPWORDS:
            continue
        tokens.append(word)
    return tokens


# ---------------------------------------------------------------------
# DB から文書を組み立てる
# ---------------------------------------------------------------------

def _skills_text(names: list[str]) -> str:
    return " ".join(n for n in names for _ in range(SKILL_WEIGHT))


def load_project_docs(conn: sqlite3.Connection, project_ids: list[int] | None = None) -> dict[int, str]:
    """案件の文書（公開中・募集終了・契約済み。応募者のスコア表示に使うため終了後も残す）"""
    where, params = ("p.status IN ('published','closed','contracted')", []) if project_ids is None else (
        f"p.id IN ({','.join('?' * len(project_ids))})", project_ids)
    rows = conn.execute(f"""
        SELECT p.id,
               COALESCE(p.public_title,'') || ' ' ||
               COALESCE(p.public_description,'') || ' ' ||
               COALESCE(p.ai_requirements,'')                       AS body,
               (SELECT GROUP_CONCAT(s.name, '|') FROM project_skills ps
                  JOIN skills s ON s.id = ps.skill_id WHERE ps.project_id = p.id)   AS skills,
               (SELECT GROUP_CONCAT(o.label, ' ') FROM project_issues pi
                  JOIN issue_options o ON o.id = pi.issue_option_id WHERE pi.project_id = p.id) AS issues
        FROM projects p WHERE {where}
    """, params).fetchall()
    return {
        r[0]: f"{r[1]} {r[3] or ''} {_skills_text((r[2] or '').split('|') if r[2] else [])}"
        for r in rows
    }


def load_talent_docs(conn: sqlite3.Connection, talent_ids: list[int] | None = None) -> dict[int, str]:
    """有効な（または指定した）人材の文書"""
    where, params = ("t.is_active = 1", []) if talent_ids is None else (
        f"t.id IN ({','.join('?' * len(talent_ids))})", talent_ids)
    rows = conn.execute(f"""
        SELECT t.id,
               COALESCE(t.bio,'') || ' ' || COALESCE(t.main_job,'')   AS body,
               (SELECT GROUP_CONCAT(s.name, '|') FROM talent_skills ts
                  JOIN skills s ON s.id = ts.skill_id WHERE ts.talent_id = t.id)   AS skills,
               (SELECT GROUP_CONCAT(a.title || ' ' || COALESCE(a.description,''), ' ')
                  FROM achievements a WHERE a.talent_id = t.id AND a.is_public = 1) AS achievements
        FROM talents t WHERE {where}
    """, params).fetchall()
    return {
        r[0]: f"{r[1]} {r[3] or ''} {_skills_text((r[2] or '').split('|') if r[2] else [])}"
        for r in rows
    }


# ---------------------------------------------------------------------
# マッチング本体
# ---------------------------------------------------------------------

@dataclass
class Match:
    project_id: int
    talent_id: int
    score: float          # 0〜1（コサイン類似度）
    keywords: list[str]   # 一致に効いた語（画面で「マッチ理由」として出せる）


def _build(project_docs: dict[int, str], talent_docs: dict[int, str]):
    vec = TfidfVectorizer(
        tokenizer=tokenize,
        token_pattern=None,     # tokenizer を使うので不要
        lowercase=False,        # normalize で済ませている
        sublinear_tf=True,      # 同じ語の繰り返しで点数が伸びすぎないように
        min_df=1,
    )
    # 案件と人材をまとめて学習 → 同じ語彙・同じIDFで比べられる
    corpus = list(project_docs.values()) + list(talent_docs.values())
    X = vec.fit_transform(corpus)
    n = len(project_docs)
    return vec, X[:n], X[n:]


def _top_keywords(vec, p_row, t_row, k: int = 5) -> list[str]:
    contrib = p_row.multiply(t_row)               # 両方に出てくる語だけ値が残る
    if contrib.nnz == 0:
        return []
    terms = vec.get_feature_names_out()
    idx = contrib.indices[contrib.data.argsort()[::-1][:k]]
    return [terms[i] for i in idx]


def match_all(conn: sqlite3.Connection) -> list[Match]:
    """公開中の全案件 × 有効な全人材 のスコアを計算"""
    p_docs, t_docs = load_project_docs(conn), load_talent_docs(conn)
    if not p_docs or not t_docs:
        return []
    vec, P, T = _build(p_docs, t_docs)
    sim = cosine_similarity(P, T)
    p_ids, t_ids = list(p_docs), list(t_docs)
    return [
        Match(p_ids[i], t_ids[j], float(sim[i, j]), _top_keywords(vec, P[i], T[j]))
        for i in range(len(p_ids)) for j in range(len(t_ids))
    ]


def recommend_talents(conn: sqlite3.Connection, project_id: int, top_n: int = 10,
                      min_score: float = 0.05) -> list[Match]:
    """企業アプリ用：この案件に合う人材"""
    ms = [m for m in match_all_for(conn, project_id=project_id) if m.score >= min_score]
    return sorted(ms, key=lambda m: m.score, reverse=True)[:top_n]


def recommend_projects(conn: sqlite3.Connection, talent_id: int, top_n: int = 10,
                       min_score: float = 0.05) -> list[Match]:
    """人材アプリ用：この人材に合う公開中の案件"""
    ms = [m for m in match_all_for(conn, talent_id=talent_id) if m.score >= min_score]
    return sorted(ms, key=lambda m: m.score, reverse=True)[:top_n]


def match_all_for(conn: sqlite3.Connection, *, project_id: int | None = None,
                  talent_id: int | None = None) -> list[Match]:
    # IDF は全体の文書で計算したいので、全件で学習してから絞り込む
    return [m for m in match_all(conn)
            if (project_id is None or m.project_id == project_id)
            and (talent_id is None or m.talent_id == talent_id)]


def refresh_match_scores(conn: sqlite3.Connection) -> int:
    """match_scores テーブルを作り直す（案件公開時・プロフィール更新時・夜間バッチで呼ぶ）"""
    ms = match_all(conn)
    with conn:
        conn.execute("DELETE FROM match_scores")
        conn.executemany(
            "INSERT INTO match_scores (project_id, talent_id, score, keywords) VALUES (?,?,?,?)",
            [(m.project_id, m.talent_id, round(m.score, 4), ",".join(m.keywords)) for m in ms],
        )
    return len(ms)
