"use client";

import { formatHours } from "@/lib/diagnosis";

export interface EffortPoint {
  key: string | number;
  /** 棒の下に出す文字（第3版、2026/11 など） */
  label: string;
  /** 削減工数（月あたり・時間）。出せないときは null */
  value: number | null;
  /** マウスを乗せたときの説明 */
  title?: string;
}

/**
 * 削減工数の棒グラフ（1つの系列）。0 の線から、減ったぶんは上へ、増えてしまったぶんは下へ伸びる。
 * 点が少ないときは値を棒の上にそのまま書く。多いときは最後の棒だけに書く（同じ数字は表にもある）。
 */
export function EffortChart({ points, ariaLabel }: { points: EffortPoint[]; ariaLabel: string }) {
  const W = 640;
  const H = 210;
  const pad = { top: 24, right: 12, bottom: 28, left: 12 };
  const vals = points.map((p) => p.value ?? 0);
  const max = Math.max(1, ...vals) * 1.15;
  const min = Math.min(0, ...vals) * 1.15;
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * ((max - v) / (max - min));
  const zero = y(0);
  const slot = (W - pad.left - pad.right) / Math.max(points.length, 4);
  const bw = Math.min(44, slot * 0.55);
  const dense = points.length > 10;
  const tickEvery = Math.ceil(points.length / 10);
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      {points.map((p, i) => {
        const cx = pad.left + slot * (i + 0.5);
        const v = p.value ?? 0;
        const top = y(v);
        const h = Math.abs(zero - top);
        const r = Math.min(4, h);
        const last = i === points.length - 1;
        const x0 = cx - bw / 2;
        const x1 = cx + bw / 2;
        // 0の線に付けて、反対側の端だけ角を丸める
        const d =
          v >= 0
            ? `M${x0},${zero} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x1 - r} Q${x1},${top} ${x1},${top + r} V${zero} Z`
            : `M${x0},${zero} V${top - r} Q${x0},${top} ${x0 + r},${top} H${x1 - r} Q${x1},${top} ${x1},${top - r} V${zero} Z`;
        return (
          <g key={p.key}>
            <title>{p.title ?? `${p.label}：${formatHours(p.value)}`}</title>
            {/* 細い棒でも乗せやすいように、列ぜんたいを当たり判定にする */}
            <rect x={cx - slot / 2} y={0} width={slot} height={H} fill="transparent" />
            {p.value !== null && h > 0 && <path className={`trend-bar${last ? " latest" : ""}${v < 0 ? " minus" : ""}`} d={d} />}
            {(!dense || last) && (
              <text x={cx} y={v >= 0 ? top - 6 : top + 14} textAnchor="middle" className="trend-value">
                {formatHours(p.value)}
              </text>
            )}
            {(i % tickEvery === 0 || last) && (
              <text x={cx} y={H - 8} textAnchor="middle" className="trend-tick">
                {p.label}
              </text>
            )}
          </g>
        );
      })}
      <line x1={pad.left} x2={W - pad.right} y1={zero} y2={zero} className="trend-axis" />
    </svg>
  );
}
