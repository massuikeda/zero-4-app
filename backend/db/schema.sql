-- =====================================================================
-- zero-4-app  DBスキーマ（SQLite）
--   企業 × Tech0人材 マッチングアプリ
--   元資料：サービスブループリント ver1（企業 / 人材 / 福岡銀行担当者）
--
-- 方針
--   ・ログインは「企業」「人材」「銀行担当者」でテーブルを分ける（アプリが別のため）
--   ・日時は TEXT（ISO8601, UTC）  例: '2026-11-07T09:00:00Z'
--   ・真偽値は INTEGER（0/1）
--   ・金額は INTEGER（円）
--   ・区分値は CHECK 制約で縛る
--   ・接続ごとに PRAGMA foreign_keys = ON; を実行すること（SQLiteは既定でOFF）
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 1. 銀行（福岡銀行）
-- ---------------------------------------------------------------------

-- 支店
CREATE TABLE branches (
    id          INTEGER PRIMARY KEY,
    code        TEXT    NOT NULL UNIQUE,          -- 支店コード
    name        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 銀行担当者（営業担当）※ログインあり
CREATE TABLE bank_staff (
    id             INTEGER PRIMARY KEY,
    branch_id      INTEGER NOT NULL REFERENCES branches(id),
    name           TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE,
    password_hash  TEXT    NOT NULL,
    is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 企業コード（紹介コード）
--   営業担当が面談時に企業へ渡す。登録時に照合し、支店・担当者をひも付ける
CREATE TABLE company_codes (
    id             INTEGER PRIMARY KEY,
    code           TEXT    NOT NULL UNIQUE,
    bank_staff_id  INTEGER NOT NULL REFERENCES bank_staff(id),
    branch_id      INTEGER NOT NULL REFERENCES branches(id),
    issued_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    expires_at     TEXT,
    used_at        TEXT                                      -- 企業登録で使われた日時
);

-- ---------------------------------------------------------------------
-- 2. 企業
-- ---------------------------------------------------------------------

CREATE TABLE companies (
    id               INTEGER PRIMARY KEY,
    company_code_id  INTEGER NOT NULL UNIQUE REFERENCES company_codes(id),
    branch_id        INTEGER NOT NULL REFERENCES branches(id),     -- 紹介元支店
    bank_staff_id    INTEGER NOT NULL REFERENCES bank_staff(id),   -- 紹介元担当者
    name             TEXT    NOT NULL,
    industry         TEXT,
    employee_count   INTEGER,
    address          TEXT,
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 企業ユーザー（兼任担当者・経営者）※企業アプリのログイン
CREATE TABLE company_users (
    id             INTEGER PRIMARY KEY,
    company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE,
    password_hash  TEXT    NOT NULL,
    role           TEXT    NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','member')),
    is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------------------------------------------------------------------
-- 3. 人材（Tech0人材）
-- ---------------------------------------------------------------------

-- 人材 ※人材アプリのログイン
CREATE TABLE talents (
    id                    INTEGER PRIMARY KEY,
    email                 TEXT    NOT NULL UNIQUE,
    password_hash         TEXT    NOT NULL,
    name                  TEXT    NOT NULL,
    display_name          TEXT,                                 -- 公開プロフィール用
    bio                   TEXT,
    main_job              TEXT,                                 -- 本業（競合確認用）
    available_hours_month INTEGER NOT NULL DEFAULT 10,          -- 稼働可能時間/月
    is_profile_public     INTEGER NOT NULL DEFAULT 0 CHECK (is_profile_public IN (0,1)),
    is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- スキル（マスタ）
CREATE TABLE skills (
    id        INTEGER PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE,
    category  TEXT                                   -- 例: 開発 / データ / マーケ / 業務改善
);

-- 人材のスキル
CREATE TABLE talent_skills (
    talent_id  INTEGER NOT NULL REFERENCES talents(id) ON DELETE CASCADE,
    skill_id   INTEGER NOT NULL REFERENCES skills(id),
    years      INTEGER,
    PRIMARY KEY (talent_id, skill_id)
);

-- 報酬振込口座（みんなの銀行）
CREATE TABLE talent_bank_accounts (
    id                   INTEGER PRIMARY KEY,
    talent_id            INTEGER NOT NULL UNIQUE REFERENCES talents(id) ON DELETE CASCADE,
    bank_name            TEXT    NOT NULL DEFAULT 'みんなの銀行',
    branch_code          TEXT    NOT NULL,
    account_type         TEXT    NOT NULL DEFAULT 'ordinary' CHECK (account_type IN ('ordinary','checking')),
    account_number       TEXT    NOT NULL,
    account_holder_kana  TEXT    NOT NULL,
    verified_at          TEXT,                       -- 口座確認済み日時
    created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------------------------------------------------------------------
-- 4. 課題入力 → 案件（AI要約・要件化・公開）
-- ---------------------------------------------------------------------

-- 課題の選択肢（マスタ）※課題入力画面のチェック項目
CREATE TABLE issue_options (
    id          INTEGER PRIMARY KEY,
    category    TEXT    NOT NULL,                   -- 例: 集客 / 業務効率化 / IT基盤
    label       TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- 案件
--   draft      : 課題入力中
--   generated  : AIが要件案を作成済み（企業が確認・修正）
--   published  : 人材に公開中（企業名は伏せる）
--   closed     : 募集終了
--   contracted : 契約済み
CREATE TABLE projects (
    id                  INTEGER PRIMARY KEY,
    company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_by          INTEGER NOT NULL REFERENCES company_users(id),
    status              TEXT    NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','generated','published','closed','contracted')),
    -- 企業の入力
    issue_free_text     TEXT,                       -- 自由記述
    -- AIの出力
    ai_summary          TEXT,                       -- 課題の要約
    ai_requirements     TEXT,                       -- 人材要件の案
    ai_generated_at     TEXT,
    -- 公開内容（企業名なし）
    public_title        TEXT,
    public_description  TEXT,
    hours_per_month     INTEGER NOT NULL DEFAULT 10,
    duration_months     INTEGER NOT NULL DEFAULT 3 CHECK (duration_months BETWEEN 1 AND 12),
    monthly_fee         INTEGER,                    -- 委託料（円/月）
    published_at        TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 案件で選ばれた課題（チェック項目）
CREATE TABLE project_issues (
    project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_option_id  INTEGER NOT NULL REFERENCES issue_options(id),
    PRIMARY KEY (project_id, issue_option_id)
);

-- 案件で求めるスキル
CREATE TABLE project_skills (
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    skill_id    INTEGER NOT NULL REFERENCES skills(id),
    PRIMARY KEY (project_id, skill_id)
);

-- ---------------------------------------------------------------------
-- 5. 応募・面談
-- ---------------------------------------------------------------------

CREATE TABLE applications (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    talent_id   INTEGER NOT NULL REFERENCES talents(id),
    message     TEXT,
    status      TEXT    NOT NULL DEFAULT 'applied'
                CHECK (status IN ('applied','interview','selected','rejected','withdrawn')),
    applied_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (project_id, talent_id)                  -- 同じ案件に二重応募させない
);

-- 面談（30分）
CREATE TABLE interviews (
    id              INTEGER PRIMARY KEY,
    application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    scheduled_at    TEXT    NOT NULL,
    duration_min    INTEGER NOT NULL DEFAULT 30,
    meeting_url     TEXT,
    status          TEXT    NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','done','canceled')),
    company_memo    TEXT
);

-- ---------------------------------------------------------------------
-- 6. 契約（準委任）
-- ---------------------------------------------------------------------

CREATE TABLE contracts (
    id                      INTEGER PRIMARY KEY,
    project_id              INTEGER NOT NULL UNIQUE REFERENCES projects(id),   -- 1案件1契約
    application_id          INTEGER NOT NULL UNIQUE REFERENCES applications(id),
    company_id              INTEGER NOT NULL REFERENCES companies(id),
    talent_id               INTEGER NOT NULL REFERENCES talents(id),
    template_version        TEXT    NOT NULL,       -- 準委任の雛形バージョン
    start_date              TEXT    NOT NULL,       -- 'YYYY-MM-DD'
    end_date                TEXT    NOT NULL,
    hours_per_month         INTEGER NOT NULL DEFAULT 10,
    monthly_fee             INTEGER NOT NULL,
    nda_agreed_at           TEXT,                   -- 人材：守秘義務の確認
    no_conflict_agreed_at   TEXT,                   -- 人材：本業との競合なしの確認
    company_signed_at       TEXT,
    talent_signed_at        TEXT,
    status                  TEXT    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','active','completed','canceled')),
    created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    CHECK (end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- 7. 実行（定例・タスク・稼働記録）
-- ---------------------------------------------------------------------

-- 隔週の定例
CREATE TABLE meetings (
    id           INTEGER PRIMARY KEY,
    contract_id  INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    held_at      TEXT    NOT NULL,
    minutes      TEXT,                              -- 議事メモ
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- タスク
CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY,
    contract_id  INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    title        TEXT    NOT NULL,
    description  TEXT,
    owner        TEXT    NOT NULL DEFAULT 'talent' CHECK (owner IN ('talent','company')),
    status       TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
    due_date     TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 稼働記録（月10時間の管理・支払時の突き合わせに使う）
CREATE TABLE work_logs (
    id           INTEGER PRIMARY KEY,
    contract_id  INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    work_date    TEXT    NOT NULL,                  -- 'YYYY-MM-DD'
    hours        REAL    NOT NULL CHECK (hours > 0 AND hours <= 24),
    kind         TEXT    NOT NULL DEFAULT 'work' CHECK (kind IN ('work','meeting','report')),
    description  TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------------------------------------------------------------------
-- 8. レポート・閲覧範囲（同意）
-- ---------------------------------------------------------------------

-- 月次レポート
CREATE TABLE reports (
    id                   INTEGER PRIMARY KEY,
    contract_id          INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    period               TEXT    NOT NULL,          -- 'YYYY-MM'
    summary              TEXT,                      -- 銀行に共有しうる要約
    body                 TEXT,                      -- 詳細（NDA範囲）
    next_plan            TEXT,
    status               TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved')),
    submitted_at         TEXT,
    company_viewed_at    TEXT,
    company_approved_at  TEXT,                      -- 検収（要否は未決のため任意）
    UNIQUE (contract_id, period)
);

-- 銀行への共有同意（企業・人材それぞれ）
--   scope: none = 共有しない / summary = 要約のみ / full = 本文まで
--   銀行が見られる範囲 = 企業と人材の scope のうち狭いほう
CREATE TABLE sharing_consents (
    id            INTEGER PRIMARY KEY,
    contract_id   INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    party         TEXT    NOT NULL CHECK (party IN ('company','talent')),
    scope         TEXT    NOT NULL DEFAULT 'none' CHECK (scope IN ('none','summary','full')),
    agreed_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    revoked_at    TEXT,
    UNIQUE (contract_id, party)
);

-- ---------------------------------------------------------------------
-- 9. 支払い
-- ---------------------------------------------------------------------

--   企業 → みんなの銀行へ委託料を振込 → 運営が入金確認・稼働と突き合わせ → 人材へ振込（60日以内）
CREATE TABLE payments (
    id                 INTEGER PRIMARY KEY,
    contract_id        INTEGER NOT NULL REFERENCES contracts(id),
    period             TEXT    NOT NULL,            -- 'YYYY-MM'
    amount             INTEGER NOT NULL CHECK (amount >= 0),
    billed_hours       REAL,                        -- 突き合わせた稼働時間
    due_date           TEXT    NOT NULL,            -- 人材への支払期限（60日以内）
    company_paid_at    TEXT,                        -- 企業からの入金確認
    talent_paid_at     TEXT,                        -- 人材口座への振込
    status             TEXT    NOT NULL DEFAULT 'billed'
                       CHECK (status IN ('billed','received','paid','overdue')),
    created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (contract_id, period)
);

-- ---------------------------------------------------------------------
-- 10. 評価・実績公開
-- ---------------------------------------------------------------------

-- 企業から人材への評価（★1〜5）
CREATE TABLE evaluations (
    id           INTEGER PRIMARY KEY,
    contract_id  INTEGER NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
    rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 人材の実績（公開プロフィールに出す項目を人材が選ぶ）
CREATE TABLE achievements (
    id                INTEGER PRIMARY KEY,
    talent_id         INTEGER NOT NULL REFERENCES talents(id) ON DELETE CASCADE,
    contract_id       INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
    title             TEXT    NOT NULL,
    description       TEXT,
    show_industry     INTEGER NOT NULL DEFAULT 1 CHECK (show_industry IN (0,1)),   -- 業種を出すか
    show_rating       INTEGER NOT NULL DEFAULT 1 CHECK (show_rating   IN (0,1)),   -- 評価を出すか
    is_public         INTEGER NOT NULL DEFAULT 0 CHECK (is_public     IN (0,1)),
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------------------------------------------------------------------
-- 11. 通知・送客
-- ---------------------------------------------------------------------

-- 通知（企業ユーザー / 人材 / 銀行担当者の共通）
--   ログインテーブルが分かれているため recipient_type + recipient_id で指す（FKなし）
CREATE TABLE notifications (
    id              INTEGER PRIMARY KEY,
    recipient_type  TEXT    NOT NULL CHECK (recipient_type IN ('company_user','talent','bank_staff')),
    recipient_id    INTEGER NOT NULL,
    type            TEXT    NOT NULL,       -- 例: company_registered / applied / report_submitted
    title           TEXT    NOT NULL,
    body            TEXT,
    link_path       TEXT,
    read_at         TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 送客の記録（大型案件を既存の人材紹介へつなぐ）
CREATE TABLE bank_referrals (
    id             INTEGER PRIMARY KEY,
    company_id     INTEGER NOT NULL REFERENCES companies(id),
    bank_staff_id  INTEGER NOT NULL REFERENCES bank_staff(id),
    project_id     INTEGER REFERENCES projects(id),
    note           TEXT,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------------------------------------------------------------------
-- 12. マッチング（TF-IDF のスコア保存）
-- ---------------------------------------------------------------------

-- 案件 × 人材 の類似度。backend/matching/tfidf.py の refresh_match_scores() で作り直す
CREATE TABLE match_scores (
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    talent_id    INTEGER NOT NULL REFERENCES talents(id)  ON DELETE CASCADE,
    score        REAL    NOT NULL CHECK (score BETWEEN 0 AND 1),
    keywords     TEXT,                      -- 一致した語（カンマ区切り）＝「マッチ理由」表示用
    computed_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (project_id, talent_id)
);

-- ---------------------------------------------------------------------
-- インデックス（よく使う検索）
-- ---------------------------------------------------------------------
CREATE INDEX idx_companies_staff       ON companies(bank_staff_id);
CREATE INDEX idx_company_users_company ON company_users(company_id);
CREATE INDEX idx_projects_company      ON projects(company_id);
CREATE INDEX idx_projects_status       ON projects(status, published_at);
CREATE INDEX idx_applications_talent   ON applications(talent_id);
CREATE INDEX idx_contracts_company     ON contracts(company_id);
CREATE INDEX idx_contracts_talent      ON contracts(talent_id);
CREATE INDEX idx_work_logs_contract    ON work_logs(contract_id, work_date);
CREATE INDEX idx_notifications_to      ON notifications(recipient_type, recipient_id, read_at);
CREATE INDEX idx_match_talent          ON match_scores(talent_id, score DESC);
CREATE INDEX idx_match_project         ON match_scores(project_id, score DESC);

-- ---------------------------------------------------------------------
-- ビュー：人材向け案件一覧（企業名を含めない）
-- ---------------------------------------------------------------------
CREATE VIEW v_public_projects AS
SELECT p.id,
       p.public_title,
       p.public_description,
       p.hours_per_month,
       p.duration_months,
       p.monthly_fee,
       c.industry,                -- 業種までは出す / 企業名は出さない
       p.published_at
FROM projects p
JOIN companies c ON c.id = p.company_id
WHERE p.status = 'published';
