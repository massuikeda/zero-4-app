"""削減工数（月あたり・時間）。AS-ISの第1版とくらべて、どれだけ作業時間が減ったか。

  自動の値 ＝（第1版の作業時間の合計 − その版の作業時間の合計）× 月の件数
  版ごとに手で入力した値（実績など）があれば、そちらを使う

月の件数は、業務の「月の件数」。空なら頻度の文字（「日30件」など）から換算する（frontend/lib/cost.ts と同じルール）。
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

WORKDAYS_PER_MONTH = 20
WEEKS_PER_MONTH = 4
_ZEN = str.maketrans("０１２３４５６７８９", "0123456789")
_FREQ = re.compile(r"(日|週|月|年)[^\d]*(\d+(?:\.\d+)?)")


def monthly_count_from_frequency(frequency: str | None) -> int | None:
    """「日30件」「月200件」「週に20件」「年間1,200件」などから、月の件数を出す。読み取れなければ None"""
    t = (frequency or "").translate(_ZEN).replace("，", "").replace(",", "")
    m = _FREQ.search(t)
    if not m:
        return None
    n = float(m.group(2))
    per_month = {"日": n * WORKDAYS_PER_MONTH, "週": n * WEEKS_PER_MONTH, "月": n, "年": n / 12}[m.group(1)]
    return int(per_month + 0.5)  # 四捨五入（画面の Math.round と同じ）


def monthly_count(business) -> int | None:
    """計算に使う月の件数。入力されていればそれ、なければ頻度から換算"""
    if business.monthly_count is not None:
        return business.monthly_count
    return monthly_count_from_frequency(business.frequency)


def total_minutes(data: dict | None) -> int:
    """作業時間の合計（1回あたり・分）"""
    return sum(int(s.get("minutes") or 0) for s in (data or {}).get("steps") or [])


def auto_saved_hours(first_minutes: int, minutes: int, count: int | None) -> float | None:
    """自動の値（月あたり・時間）。月の件数が分からなければ None"""
    if count is None:
        return None
    return round((first_minutes - minutes) * count / 60, 1)


def month_of(dt: datetime | None) -> str:
    """日本時間での年月（2026-11）"""
    return ((dt or datetime.now(timezone.utc)) + timedelta(hours=9)).strftime("%Y-%m")
