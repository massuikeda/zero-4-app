# DBの変更（AS-ISの版・診断の履歴）

TO-BEの1本化と、AS-ISの版・診断の履歴の追加で、DBに足すものをまとめています。
**足すだけで、今あるテーブルの列やデータは変えません・消しません。**

## 何が増えるか

| 種類 | 名前 | 中身 |
|---|---|---|
| テーブルを追加 | `flow_versions` | AS-ISの版。AS-ISを保存するたびに、その時点の中身が1行増える |
| テーブルを追加 | `diagnoses` | 診断の記録（DX診断・改善提案） |
| テーブルを追加 | `diagnosis_flows` | 診断の記録と、そのとき選んだAS-ISの版の結び付き |

テーブルの関係は `docs/ER.md`。

起動時に、データも1種類だけ足す：**版がまだ1つもない業務の、いまのAS-ISを「第1版」として `flow_versions` に入れる**
（版の仕組みができる前に保存されたAS-ISを、さかのぼれるようにするため。何度起動しても増えない）。

## 変えていないもの

- `flows.kind` の値はそのまま。TO-BEは、3案だったころの「松」と同じ `tobe_matsu` の行を使う
- 梅・竹（`tobe_ume`・`tobe_take`）の行は、残っていても画面に出ないだけ（消さなくても動く）
- `businesses.adopted_plan` の列は残してある（使っていない）
- 単価表（`cost_items` テーブル）は使わなくなった。すでにあるDBでは、テーブルが残るだけ（新しく作るDBには作られない）

## 反映のしかた

### ローカル（SQLite）

何もしなくてよい。バックエンドを起動し直すと、起動時の処理（`backend/app/db.py` の `init_db`）が足りないテーブルを足す。

### Azure（MySQL）

どちらか一方でよい。

**A. アプリに任せる（これまでの列追加と同じやり方）**

1. `main` に push する（バックエンドがデプロイされる）
2. 起動時に `init_db` が、足りないテーブル3つを足し、いまのAS-ISを第1版として入れる
3. `<バックエンドのURL>/api/health` が `{"status":"ok","db":"mysql",...}` を返すことを確かめる
4. 企業ページを開いて「ヒアリング履歴」タブが出ることを確かめる

**B. 先に手でSQLを流す（デプロイの前に、DBだけ先に用意したいとき）**

下のSQLを、上から順に実行する。あとでアプリが起動しても、すでにあるものは作り直さない（第1版は、起動時にアプリが入れる）。

```sql
CREATE TABLE flow_versions (
  id INTEGER NOT NULL AUTO_INCREMENT,
  business_id INTEGER NOT NULL,
  number INTEGER NOT NULL,
  data JSON NOT NULL,
  saved_at DATETIME NOT NULL,
  saved_by VARCHAR(200) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (business_id, number),
  FOREIGN KEY(business_id) REFERENCES businesses (id) ON DELETE CASCADE
);

CREATE INDEX ix_flow_versions_business_id ON flow_versions (business_id);

CREATE TABLE diagnoses (
  id INTEGER NOT NULL AUTO_INCREMENT,
  company_id INTEGER NOT NULL,
  date DATE NOT NULL,
  kind VARCHAR(20) NOT NULL,
  participants VARCHAR(300) NOT NULL,
  staff VARCHAR(200) NOT NULL,
  note TEXT NOT NULL,
  gaps JSON NOT NULL,
  created_by VARCHAR(200) NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY(company_id) REFERENCES companies (id) ON DELETE CASCADE
);

CREATE INDEX ix_diagnoses_company_id ON diagnoses (company_id);

CREATE TABLE diagnosis_flows (
  id INTEGER NOT NULL AUTO_INCREMENT,
  diagnosis_id INTEGER NOT NULL,
  business_id INTEGER NOT NULL,
  version_id INTEGER NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (diagnosis_id, business_id),
  FOREIGN KEY(diagnosis_id) REFERENCES diagnoses (id) ON DELETE CASCADE,
  FOREIGN KEY(business_id) REFERENCES businesses (id) ON DELETE CASCADE,
  FOREIGN KEY(version_id) REFERENCES flow_versions (id) ON DELETE CASCADE
);

CREATE INDEX ix_diagnosis_flows_business_id ON diagnosis_flows (business_id);

CREATE INDEX ix_diagnosis_flows_diagnosis_id ON diagnosis_flows (diagnosis_id);

CREATE INDEX ix_diagnosis_flows_version_id ON diagnosis_flows (version_id);
```

### 順番の注意

- フロントエンドとバックエンドは別々にデプロイされる。今回はAPIの形が変わっているので（`/flows` の返事、TO-BEの種類）、**両方を同じ push で出す**。片方だけ新しい間は、業務ページのTO-BEが出ない・保存できないことがある
- 元に戻すとき：コードを前のコミットに戻せば、増えたテーブルは使われないだけで、残っていても害はない

## 途中まで作ってやめたもの

作っている途中で形を変えたもの。その間にバックエンドを起動したDB（ローカルの `flow.db`）には、次のものが残っていることがある。
使われないので、残っていても害はない。消したいときだけ実行する（無ければエラーになるので、あるものだけ）。

- `flow_snapshots`：版を「診断を記録したときの写し」として持っていたころのテーブル。起動時に、中身が同じ版へつなぎ直してある
- `kpis`・`kpi_values`・`companies.kpi_enabled`：外したKPIの機能のもの
- `flow_versions.saved_hours`：外した「削減工数の手入力」の列

```sql
DROP TABLE flow_snapshots;
DROP TABLE kpi_values;
DROP TABLE kpis;
ALTER TABLE companies DROP COLUMN kpi_enabled;
ALTER TABLE flow_versions DROP COLUMN saved_hours;
```

## 片付け（やってもやらなくてもよい）

梅・竹の行を消したいときだけ。**消すと元に戻せない**ので、デモデータだけであることを確かめてから。

```sql
DELETE FROM flows WHERE kind IN ('tobe_ume', 'tobe_take');
```

単価表のテーブルを消したいときだけ（中身ごと消える）。

```sql
DROP TABLE cost_items;
```
