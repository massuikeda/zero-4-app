"""お試し用データ（DB を新しく作ったときだけ入る）

ログイン（パスワードはすべて password123）
  企業: a@example.com / b@example.com / c@example.com
  人材: t1@example.com / t2@example.com / t3@example.com
  未使用の企業コード: DEMO01 / DEMO02 / DEMO03
"""

import sqlite3

from app.security import hash_password

DEMO_PASSWORD = "password123"


def seed_demo(conn: sqlite3.Connection) -> None:
    pw = hash_password(DEMO_PASSWORD)
    with conn:
        conn.executescript("""
        INSERT INTO branches (id, code, name) VALUES (1, '101', '本店営業部'), (2, '102', '天神支店');
        INSERT INTO skills (id, name, category) VALUES
          (1,'Python','開発'),(2,'Excel','業務改善'),(3,'kintone','業務改善'),(4,'SNS運用','マーケ'),
          (5,'Instagram','マーケ'),(6,'Webサイト制作','開発'),(7,'データ分析','データ'),(8,'RPA','業務改善');
        INSERT INTO issue_options (id, category, label, sort_order) VALUES
          (1,'業務効率化','紙・Excelでの管理が多い',1),(2,'業務効率化','同じ入力を何度もしている',2),
          (3,'集客','新規顧客が増えない',3),(4,'集客','SNSを活用できていない',4),
          (5,'IT基盤','ホームページが古い・ない',5),(6,'データ','売上データを活用できていない',6);
        """)
        conn.execute(
            "INSERT INTO bank_staff (id, branch_id, name, email, password_hash) VALUES (1, 1, '福岡 太郎', 'staff@example.com', ?)",
            (pw,),
        )
        conn.executemany(
            "INSERT INTO company_codes (id, code, bank_staff_id, branch_id, used_at) VALUES (?,?,1,?,?)",
            [(1, "A001", 1, "2026-10-20T00:00:00Z"), (2, "A002", 2, "2026-10-21T00:00:00Z"),
             (3, "A003", 1, "2026-10-22T00:00:00Z"), (4, "DEMO01", 1, None), (5, "DEMO02", 1, None),
             (6, "DEMO03", 2, None)],
        )
        conn.executemany(
            "INSERT INTO companies (id, company_code_id, branch_id, bank_staff_id, name, industry) VALUES (?,?,?,1,?,?)",
            [(1, 1, 1, "博多食品株式会社", "食品製造"), (2, 2, 2, "天神工務店", "建設"), (3, 3, 1, "中洲ホテル", "宿泊")],
        )
        conn.executemany(
            "INSERT INTO company_users (id, company_id, name, email, password_hash) VALUES (?,?,?,?,?)",
            [(1, 1, "博多 一郎", "a@example.com", pw), (2, 2, "天神 花子", "b@example.com", pw),
             (3, 3, "中洲 次郎", "c@example.com", pw)],
        )
        conn.executemany(
            "INSERT INTO talents (id, email, password_hash, name, display_name, bio, main_job) VALUES (?,?,?,?,?,?,?)",
            [
                (1, "t1@example.com", pw, "佐藤 健", "さとう",
                 "社内の業務改善を担当。kintoneアプリの構築やExcel VBA、RPAで紙の管理をなくしてきました。", "製造業の情報システム部"),
                (2, "t2@example.com", pw, "鈴木 美咲", "すずき",
                 "広告代理店でSNS運用とInstagram広告を担当。小さなお店のホームページ制作もしています。", "広告代理店 マーケター"),
                (3, "t3@example.com", pw, "高橋 誠", "たかはし",
                 "Pythonでのデータ分析と機械学習が専門。売上データの可視化やダッシュボード作成が得意です。", "IT企業 データサイエンティスト"),
            ],
        )
        conn.executemany("INSERT INTO talent_skills (talent_id, skill_id) VALUES (?,?)",
                         [(1, 3), (1, 2), (1, 8), (2, 4), (2, 5), (2, 6), (3, 1), (3, 7)])
        conn.executemany(
            """INSERT INTO projects (id, company_id, created_by, status, issue_free_text, ai_summary, ai_requirements,
                   public_title, public_description, monthly_fee, published_at, created_at)
               VALUES (?,?,?,'published',?,?,?,?,?,?,?,?)""",
            [
                (1, 1, 1, "受注をFAXで受けて手でExcelに転記している。在庫も紙。",
                 "受発注と在庫管理が紙とExcelに分散し、転記の手間とミスが発生している。",
                 "kintoneやExcelマクロでの業務改善経験がある方。現場へのヒアリングができる方。",
                 "受発注管理のデジタル化", "紙とExcelで行っている受発注・在庫管理をkintoneなどのクラウドに移行したい。",
                 50000, "2026-11-01T00:00:00Z", "2026-10-28T00:00:00Z"),
                (2, 2, 2, "紹介頼みで新規のお客さんが増えない。ホームページは10年前のまま。",
                 "集客が紹介に依存しており、Web・SNSでの発信ができていない。",
                 "SNS運用の経験、Webサイト制作やホームページ改善ができる方。",
                 "施工事例を発信して集客したい", "InstagramなどSNSで施工事例を発信し、ホームページからの問い合わせを増やしたい。",
                 50000, "2026-11-02T00:00:00Z", "2026-10-29T00:00:00Z"),
                (3, 3, 3, "予約と売上のデータはあるが見ていない。",
                 "予約・売上データが蓄積されているが、稼働率改善に活用できていない。",
                 "Pythonやデータ分析、ダッシュボード作成の経験がある方。",
                 "予約・売上データの分析", "予約システムと売上のデータを分析し、稼働率を上げる施策を考えたい。",
                 60000, "2026-11-03T00:00:00Z", "2026-10-30T00:00:00Z"),
            ],
        )
        conn.executemany("INSERT INTO project_skills (project_id, skill_id) VALUES (?,?)",
                         [(1, 3), (1, 2), (1, 8), (2, 4), (2, 5), (2, 6), (3, 1), (3, 7)])
        conn.executemany("INSERT INTO project_issues (project_id, issue_option_id) VALUES (?,?)",
                         [(1, 1), (1, 2), (2, 3), (2, 4), (2, 5), (3, 6)])
        conn.execute(
            "INSERT INTO applications (project_id, talent_id, message, applied_at) VALUES (2, 2, ?, '2026-11-04T10:00:00Z')",
            ("建設業のSNS運用経験があります。施工事例の撮り方からお手伝いできます。",),
        )
