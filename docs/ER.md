# ER図（データベースの構成）

`backend/app/db.py` のテーブル定義から作成しています。GitHub上ではこの図がそのまま描画されます（画像版は `er.png`）。

```mermaid
erDiagram
    companies ||--o{ resources : "持つ"
    companies ||--o{ businesses : "持つ"
    companies |o--o{ users : "所属（管理者は所属なし）"
    businesses ||--o{ flows : "AS-IS・TO-BE（最大2件）"
    businesses ||--o{ assignments : "割り当て"
    users ||--o{ assignments : "割り当て"

    companies {
        int id PK
        string name "企業名"
        text note "メモ（業種・規模など）"
        datetime created_at "作成日時"
    }
    resources {
        int id PK
        int company_id FK "企業"
        string kind "部署・担当者・取引先・システム・帳票"
        string name "名前"
        text note "メモ"
        int sort "並び順"
    }
    users {
        int id PK
        string email UK "ログインに使うメール"
        string name "名前"
        string role "admin（管理者）・member（担当者）"
        int company_id FK "所属企業（管理者は空）"
    }
    businesses {
        int id PK
        int company_id FK "企業"
        string name "業務名"
        string department "部署"
        string frequency "頻度"
        text description "概要"
        text hearing_notes "ヒアリングメモ"
        text exec_view "経営者の認識"
        text field_view "現場の実態"
        datetime updated_at "更新日時"
    }
    flows {
        int id PK
        int business_id FK "業務（kindと組で一意）"
        string kind "asis・tobe"
        json data "図の中身（列・作業・矢印）"
        int version "同時編集の上書き防止"
        datetime updated_at "更新日時"
        string updated_by "更新した人"
    }
    assignments {
        int user_id PK,FK "担当者"
        int business_id PK,FK "見られる業務"
    }
```

## テーブルの役割

| テーブル | 役割 |
|---|---|
| companies | 企業 |
| resources | 企業ごとのリソース（部署・担当者・取引先・システム・帳票）。図の列や道具の候補になる |
| users | ログインする人。管理者（admin）は企業に所属しない。担当者（member）はどこか1社に所属 |
| businesses | 業務。ヒアリングメモ・経営者の認識・現場の実態もここに入る |
| flows | 業務フロー本体。1つの業務に AS-IS と TO-BE が最大1件ずつ（business_id と kind の組で一意） |
| assignments | どの担当者がどの業務を見られる・編集できるか（多対多） |

- 削除のルール：企業を消すと、その企業のリソース・業務・担当者・フロー・割り当てもまとめて消えます（ON DELETE CASCADE）
- `flows.version` は保存のたびに1増え、古い画面からの上書きを防ぎます

## flows.data の中身（JSON）

図の中身は、表を分けずに1つのJSONとして保存しています（形は `backend/app/schemas.py` の `Flow` / `Step`）。

```
{
  "lanes": ["取引先", "営業部（受注）", "倉庫（出荷）"],     … 列（担当）の並び
  "steps": [
    {
      "id": "S02",                  … 作業のID
      "lane": "営業部（受注）",       … 担当（列）
      "row": 0,                     … 図の行（上から0,1,2…。null なら自動配置）
      "type": "作業",               … 作業・判断・システム処理・帳票・待ち
      "name": "FAXを見て手入力",
      "tool": "エクセル",            … 色付きの札（resources の名前を書き写したもの）
      "minutes": 15,
      "pc": true,                   … 画面（PC作業）
      "manual_input": true,         … （今は使っていない。手入力の集計は作業名から自動で判断）
      "money": false,               … ¥ お金の流れ
      "issue": "ボトルネック",       … ボトルネックの印（null ならボトルネックではない）
      "issue_time": "手書きの文字を読み取りながら1件ずつ入力している",  … 時間がかかっている理由
      "issue_error": "手書き文字の読み間違い",   … ミスの原因
      "issue_detail": "",           … 旧データの説明（今は使わない）
      "third_party": false,         … 第三者の気づき
      "change": null,               … TO-BEの変更区分（統合・入替・簡素化・自動化・新規）
      "note": "",                   … 補足（TO-BEでは変更内容）
      "next": ["S03"],              … 矢印の行き先
      "next_media": ["メール"],      … 矢印ごとの受け渡し手段（next と同じ順）
      "condition_labels": []        … 矢印ごとの分岐ラベル（判断のとき）
    }
  ]
}
```

※ `tool` や `lane` はリソースの「名前」を書き写しているため、あとでリソース名を変えても、作成済みの図の表記は変わりません。
