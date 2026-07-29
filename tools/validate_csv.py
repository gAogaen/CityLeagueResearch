#!/usr/bin/env python3
"""シティリーグCSVの列・プレイヤーID・開催都道府県・CSPの簡易検査。"""
from __future__ import annotations

import csv
import re
import sys
from collections import Counter
from pathlib import Path

PREFECTURES = (
    "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 "
    "新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 "
    "奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 "
    "熊本県 大分県 宮崎県 鹿児島県 沖縄県"
).split()


def first(row: dict[str, str], *names: str) -> str:
    return next((row.get(name, "").strip() for name in names if row.get(name, "").strip()), "")


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/cityleague_results.csv")
    if not path.exists():
        print(f"見つかりません: {path}", file=sys.stderr)
        return 1

    counts = Counter()
    player_ids: set[str] = set()
    years = Counter()
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        print("列:", ", ".join(reader.fieldnames or []))
        for row in reader:
            counts["rows"] += 1
            player_raw = first(row, "プレイヤーID", "player_id")
            player_match = re.search(r"\d{8,12}", player_raw)
            if not player_match:
                counts["bad_player_id"] += 1
            else:
                player_ids.add(player_match.group())
            event_name = first(row, "大会名", "event_name")
            year_match = re.search(r"シティリーグ\s*(20\d{2})", event_name)
            if year_match:
                years[year_match.group(1)] += 1
            pref = first(row, "開催都道府県", "会場都道府県", "店舗都道府県", "都道府県", "venue_prefecture")
            if not any(name in pref for name in PREFECTURES):
                counts["missing_prefecture"] += 1
            csp = first(row, "獲得CSP", "獲得ポイント", "CSP", "csp", "points")
            raw = first(row, "元テキスト", "source_text", "raw_text")
            if not csp and not re.search(r"\d{1,3}\s*pt", raw, re.I):
                counts["missing_csp"] += 1

    print(f"行数: {counts['rows']:,}")
    print(f"ユニークプレイヤーID: {len(player_ids):,}")
    print("シリーズ年度:", dict(sorted(years.items())))
    print(f"不正/不足プレイヤーID: {counts['bad_player_id']:,}")
    print(f"開催都道府県不足: {counts['missing_prefecture']:,}")
    print(f"CSP列・pt表記ともに不足: {counts['missing_csp']:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
