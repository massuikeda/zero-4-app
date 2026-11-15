# ER図（データベースの構成）

`backend/app/db.py` のテーブル定義から作成しています。GitHub上ではこの図がそのまま描画されます（画像版は `er.png`）。

```mermaid
erDiagram
    companies ||--o{ resources : "持つ"
    companies ||--o{ businesses : "持つ"
    companies |o--o{ users : "所属（管理者は所属なし）"
    businesses ||--o{ flows : "AS-IS と TO-BE 3案（最大4件）"
    businesses ||--o{ assignments : "割り当て"
    users ||--o{ assignments : "割り当て"

    companies {
        int id PK
        string name "企業名"
        string industry "業種"
        int employees "従業員数（未入力は空）"
        int hourly_wage "時給（円）。費用対効果の計算用"
        text note "メモ"
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
        text hearing_raw "ヒアリングボックス（聞いたままの記録）"
        text hearing_notes "AIが整えたテキスト（AS-ISの元）"
        text exec_view "経営者の認識"
        text field_view "現場の実態"
        string adopted_plan "採用するTO-BEの案（ume・take・matsu。未選択は空）"
        int monthly_count "月の件数（空なら頻度から換算）"
        datetime updated_at "更新日時"
    }
    flows {
        int id PK
        int business_id FK "業務（kindと組で一意）"
        string kind "asis・tobe_ume・tobe_take・tobe_matsu"
        json data "図の中身（列・作業・矢印）"
        int version "同時編集の上書き防止"
        datetime updated_at "更新日時"
        string updated_by "更新した人"
    }
    cost_items {
        int id PK
        string name UK "名前（RPA・OCR など）"
        int initial_cost "初期費用（円）"
        int monthly_cost "月額（円）"
        string note "メモ"
        int sort "並び順"
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
| resources | **今は使っていません。** 以前は図の候補（部署・担当者・取引先・システム・帳票）を手で登録していました。今は、その企業の図に出てきた担当と道具を、そのまま候補にしています（テーブルとデータは残してあります） |
| users | ログインする人。管理者（admin）は企業に所属しない。担当者（member）はどこか1社に所属 |
| businesses | 業務。ヒアリングメモ・経営者の認識・現場の実態もここに入る |
| flows | 業務フロー本体。1つの業務に AS-IS が1件と、TO-BE が梅・竹・松の3案（各最大1件）。business_id と kind の組で一意 |
| cost_items | 単価表（全企業共通）。TO-BEの案で導入するものの、初期費用と月額の目安。銀行担当者だけが見られる・編集できる。ほかのテーブルとはつながっていない（案の側は、名前で参照する） |
| assignments | どの担当者がどの業務を見られる・編集できるか（多対多） |

- 削除のルール：企業を消すと、その企業のリソース・業務・担当者・フロー・割り当てもまとめて消えます（ON DELETE CASCADE）
- `flows.version` は保存のたびに1増え、古い画面からの上書きを防ぎます
- TO-BE は松竹梅の3案です（`kind` が `tobe_ume`＝梅：やり方の見直しだけ／`tobe_take`＝竹：手ごろなツールの導入／`tobe_matsu`＝松：RPA・システム連携で自動化）。1案だけだったころの `kind = tobe` の行は使いません（残っていても画面には出ません）
- `businesses.adopted_plan` は「採用する案」です。業務一覧の削減時間に使います（未選択なら竹）
- `businesses.exec_view`（経営者の認識）と `field_view`（現場の実態）は、画面から入力欄と表示を外したので、今は使っていません（列とデータは残してあります）
- 費用対効果（初期費用・月額費用・月の削減額・回収期間）は保存していません。案の `cost_items` と単価表、企業の時給、業務の月の件数から、表示のたびに計算します（`frontend/lib/cost.ts`）
- 削減時間は保存していません。AS-IS と TO-BE の作業時間の合計の差を、表示のたびに計算します

## flows.data の中身（JSON）

図の中身は、表を分けずに1つのJSONとして保存しています（形は `backend/app/schemas.py` の `Flow` / `Step`）。

```
{
  "summary": "…",                … TO-BEの案の要約（AS-ISでは使わない）
  "needs": ["RPAツール"],         … TO-BEの案で、導入・準備が必要なもの
  "cost_items": ["RPA"],          … TO-BEの案で、お金のかかる導入物（単価表の名前。単価表にない名前は「要見積もり」）
  "removed_notes": {"S05": "…"},  … TO-BEの案で、なくした作業（排除）の理由（作業ID → 理由）
  "lanes": ["取引先", "営業部（受注）", "倉庫（出荷）"],     … 列（担当）の並び
  "steps": [
    {
      "id": "S02",                  … 作業のID
      "lane": "営業部（受注）",       … 担当（列）
      "row": 0,                     … 図の行（上から0,1,2…。null なら自動配置）
      "type": "作業",               … 作業・判断・システム処理・帳票・待ち
      "name": "FAXを見て手入力",
      "tool": "エクセル",            … 色付きの札（道具の名前）
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

※ 図の候補（担当・道具）は、その企業の図に入っている `lane` と `tool` の名前から、表示のたびに集めています。
