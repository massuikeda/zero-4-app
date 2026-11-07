"""
サンプルデータで TF-IDF マッチングを試す
  実行（backend フォルダで）:  python -m matching.demo
"""
import sqlite3
from pathlib import Path

from matching.tfidf import recommend_projects, recommend_talents, refresh_match_scores

SCHEMA = Path(__file__).resolve().parent.parent / "db" / "schema.sql"


def seed(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    INSERT INTO branches (id, code, name) VALUES (1, '101', '本店営業部');
    INSERT INTO bank_staff (id, branch_id, name, email, password_hash) VALUES (1, 1, '銀行 太郎', 'staff@example.com', 'x');
    INSERT INTO company_codes (id, code, bank_staff_id, branch_id) VALUES (1,'A001',1,1),(2,'A002',1,1),(3,'A003',1,1);
    INSERT INTO companies (id, company_code_id, branch_id, bank_staff_id, name, industry) VALUES
      (1, 1, 1, 1, '博多食品', '食品製造'),
      (2, 2, 1, 1, '天神工務店', '建設'),
      (3, 3, 1, 1, '中洲ホテル', '宿泊');
    INSERT INTO company_users (id, company_id, name, email, password_hash) VALUES
      (1,1,'A','a@example.com','x'),(2,2,'B','b@example.com','x'),(3,3,'C','c@example.com','x');

    INSERT INTO skills (id, name, category) VALUES
      (1,'Python','開発'),(2,'Excel','業務改善'),(3,'kintone','業務改善'),(4,'SNS運用','マーケ'),
      (5,'Instagram','マーケ'),(6,'Webサイト制作','開発'),(7,'データ分析','データ'),(8,'RPA','業務改善');

    INSERT INTO issue_options (id, category, label) VALUES
      (1,'業務効率化','紙・Excelでの管理が多い'),(2,'集客','新規顧客が増えない'),
      (3,'IT基盤','ホームページが古い'),(4,'データ','売上データを活用できていない');

    INSERT INTO projects (id, company_id, created_by, status, public_title, public_description, ai_requirements, monthly_fee, published_at) VALUES
      (1,1,1,'published','受発注管理のデジタル化',
       '紙とExcelで行っている受発注・在庫管理をkintoneなどのクラウドに移行したい。',
       'kintoneやExcelマクロでの業務改善経験がある方。現場へのヒアリングができる方。', 50000, '2026-11-01T00:00:00Z'),
      (2,2,2,'published','施工事例を発信して集客したい',
       'InstagramなどSNSで施工事例を発信し、ホームページからの問い合わせを増やしたい。',
       'SNS運用の経験、Webサイト制作やホームページ改善ができる方。', 50000, '2026-11-02T00:00:00Z'),
      (3,3,3,'published','予約・売上データの分析',
       '予約システムと売上のデータを分析し、稼働率を上げる施策を考えたい。',
       'Pythonやデータ分析、ダッシュボード作成の経験がある方。', 60000, '2026-11-03T00:00:00Z');
    INSERT INTO project_skills VALUES (1,3),(1,2),(1,8),(2,4),(2,5),(2,6),(3,1),(3,7);
    INSERT INTO project_issues VALUES (1,1),(2,2),(2,3),(3,4);

    INSERT INTO talents (id, email, password_hash, name, display_name, bio, main_job) VALUES
      (1,'t1@example.com','x','佐藤','さとう',
       '社内の業務改善を担当。kintoneアプリの構築やExcel VBA、RPAで紙の管理をなくしてきました。','製造業の情報システム部'),
      (2,'t2@example.com','x','鈴木','すずき',
       '広告代理店でSNS運用とInstagram広告を担当。小さなお店のホームページ制作もしています。','広告代理店 マーケター'),
      (3,'t3@example.com','x','高橋','たかはし',
       'Pythonでのデータ分析と機械学習が専門。売上データの可視化やダッシュボード作成が得意です。','IT企業 データサイエンティスト');
    INSERT INTO talent_skills (talent_id, skill_id) VALUES (1,3),(1,2),(1,8),(2,4),(2,5),(2,6),(3,1),(3,7);
    """)


def main() -> None:
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    seed(conn)

    print(f"match_scores に {refresh_match_scores(conn)} 件保存\n")

    print("== 企業アプリ：案件1『受発注管理のデジタル化』に合う人材 ==")
    for m in recommend_talents(conn, project_id=1):
        print(f"  人材{m.talent_id}  score={m.score:.3f}  一致語={m.keywords}")

    print("\n== 人材アプリ：人材2（SNS・Web）に合う案件 ==")
    for m in recommend_projects(conn, talent_id=2):
        print(f"  案件{m.project_id}  score={m.score:.3f}  一致語={m.keywords}")

    print("\n== 全体のスコア表（行=案件, 列=人材） ==")
    rows = conn.execute("SELECT project_id, talent_id, score FROM match_scores ORDER BY 1,2").fetchall()
    for pid in sorted({r[0] for r in rows}):
        print(f"  案件{pid}: " + "  ".join(f"人材{t}={s:.2f}" for p, t, s in rows if p == pid))


if __name__ == "__main__":
    main()
