"""決まったフォーマットのフローから、draw.io ファイルと比較指標を作る。
（画面上の図は frontend/lib/mermaid.ts が同じルールで描く）"""
from __future__ import annotations

import re
from xml.sax.saxutils import escape

from .schemas import Comparison, Flow

CHANGE_COLORS = {
    "排除": "#9E9E9E", "統合": "#7B1FA2", "入替": "#F57C00",
    "簡素化": "#0288D1", "自動化": "#2E7D32", "新規": "#C2185B",
}
_STYLE = {
    "作業": "rounded=1;whiteSpace=wrap;html=1;",
    "判断": "rhombus;whiteSpace=wrap;html=1;",
    "システム処理": "shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;",
    "帳票": "shape=document;whiteSpace=wrap;html=1;boundedLbl=1;",
    "待ち": "shape=delay;whiteSpace=wrap;html=1;",
}
LANE_H, LANE_HEADER, COL_W, NODE_W, NODE_H = 140, 40, 180, 140, 70


def _q(s: str) -> str:
    return escape(s, {'"': "&quot;"})


def to_drawio(flow: Flow, title: str = "業務フロー") -> str:
    """スイムレーン（横）× ステップ順（縦列）の固定レイアウト"""
    cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']
    lanes = list(dict.fromkeys(list(flow.lanes) + [s.lane or "（未設定）" for s in flow.steps]))
    used = {s.lane or "（未設定）" for s in flow.steps}
    lanes = [l for l in lanes if l in used] or ["（未設定）"]
    width = LANE_HEADER + COL_W * max(len(flow.steps), 1) + 40
    for li, lane in enumerate(lanes):
        cells.append(
            f'<mxCell id="lane{li}" value="{_q(lane)}" '
            f'style="swimlane;horizontal=0;startSize={LANE_HEADER};html=1;fillColor=#F5F5F5;" vertex="1" parent="1">'
            f'<mxGeometry x="0" y="{li * LANE_H}" width="{width}" height="{LANE_H}" as="geometry"/></mxCell>'
        )
    for col, s in enumerate(flow.steps):
        li = lanes.index(s.lane or "（未設定）")
        style = _STYLE.get(s.type, _STYLE["作業"])
        if s.change:
            c = CHANGE_COLORS[s.change]
            style += f"strokeColor={c};strokeWidth=3;fillColor={c}22;"
        elif s.issue:
            style += "strokeColor=#D32F2F;strokeWidth=3;fillColor=#FFEBEE;"
        label = f"{s.id} {s.name}"
        if s.change:
            label = f"【{s.change}】<br>{label}"
        if s.tool:
            label += f"<br><font style='font-size:10px'>{s.tool}</font>"
        if s.minutes:
            label += f"<br><font style='font-size:10px'>{s.minutes}分</font>"
        tip = "\n".join(x for x in [s.issue and f"課題: {s.issue}", s.note] if x)
        tooltip = f' tooltip="{_q(tip)}"' if tip else ""
        cells.append(
            f'<UserObject id="{_q(s.id)}" label="{_q(label)}"{tooltip}>'
            f'<mxCell style="{style}" vertex="1" parent="lane{li}">'
            f'<mxGeometry x="{LANE_HEADER + 20 + col * COL_W}" y="{(LANE_H - NODE_H) // 2}" '
            f'width="{NODE_W}" height="{NODE_H}" as="geometry"/></mxCell></UserObject>'
        )
    ids = {s.id for s in flow.steps}
    e = 0
    for s in flow.steps:
        for i, n in enumerate(s.next):
            if n not in ids:
                continue
            e += 1
            label = " / ".join(
                x for x in [
                    s.condition_labels[i] if i < len(s.condition_labels) else "",
                    s.next_media[i] if i < len(s.next_media) else "",
                ] if x
            )
            cells.append(
                f'<mxCell id="e{e}" value="{_q(label)}" '
                f'style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;" edge="1" parent="1" '
                f'source="{_q(s.id)}" target="{_q(n)}"><mxGeometry relative="1" as="geometry"/></mxCell>'
            )
    return (
        f'<mxfile host="zero-4-app"><diagram name="{_q(title)}">'
        f'<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" page="1" pageWidth="1600" pageHeight="900">'
        f"<root>{''.join(cells)}</root></mxGraphModel></diagram></mxfile>"
    )


_PAPER = re.compile(r"手書き|紙|伝票|帳票|印刷|書類|注文書")


def is_paper(tool: str) -> bool:
    return bool(tool and _PAPER.search(tool))


def counters(flow: Flow) -> tuple[int, int, int]:
    """決まった3つの集計：手入力・転記の回数、メール連絡の回数、紙を使う箇所"""
    manual = sum(1 for s in flow.steps if s.manual_input)
    mail = sum(1 for s in flow.steps for i, _ in enumerate(s.next)
               if i < len(s.next_media) and "メール" in s.next_media[i])
    paper = sum(1 for s in flow.steps if is_paper(s.tool))
    return manual, mail, paper


def _handoffs(flow: Flow) -> int:
    lane = {s.id: s.lane for s in flow.steps}
    return sum(1 for s in flow.steps for n in s.next if n in lane and lane[n] != s.lane)


def compare(asis: Flow, tobe: Flow) -> Comparison:
    am = sum(s.minutes for s in asis.steps)
    tm = sum(s.minutes for s in tobe.steps)
    a, t = counters(asis), counters(tobe)
    return Comparison(
        asis_manual=a[0], tobe_manual=t[0], asis_mail=a[1], tobe_mail=t[1], asis_paper=a[2], tobe_paper=t[2],
        asis_steps=len(asis.steps), tobe_steps=len(tobe.steps),
        asis_minutes=am, tobe_minutes=tm,
        asis_handoffs=_handoffs(asis), tobe_handoffs=_handoffs(tobe),
        asis_issues=sum(1 for s in asis.steps if s.issue),
        tobe_issues=sum(1 for s in tobe.steps if s.issue),
        reduction_rate=round((am - tm) / am * 100, 1) if am else 0.0,
    )
