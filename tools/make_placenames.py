"""从 OSM 提取北京命名地点(片区/街道/村/镇)生成 placenames.json,供前端车站自动取名。

只取 place=suburb/neighbourhood/quarter/village/town 的命名节点,
优先 name:zh,过滤非中文名,按(名,粗坐标)去重。产物随站点分发,
gitignore 原始输入、产物提交(同其它数据文件)。

用法: tools/.venv/bin/python tools/make_placenames.py
产出: public/data/beijing/placenames.json
"""

import json
import time
from pathlib import Path

from gridspec import LAT_MAX, LAT_MIN, LNG_MAX, LNG_MIN
from overpass import query

OUT_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "beijing" / "placenames.json"
BBOX = f"{LAT_MIN},{LNG_MIN},{LAT_MAX},{LNG_MAX}"


def has_cjk(s: str) -> bool:
    return any("一" <= c <= "鿿" for c in s)


def main() -> None:
    t0 = time.time()
    ql = f"""
[out:json][timeout:180][bbox:{BBOX}];
node["place"~"^(suburb|neighbourhood|quarter|village|town)$"]["name"];
out qt;
"""
    data = query(ql)
    places = []
    seen = set()
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        name = (tags.get("name:zh") or tags.get("name", "")).strip()
        if not name or not has_cjk(name):
            continue
        key = (name, round(el["lon"], 3), round(el["lat"], 3))
        if key in seen:
            continue
        seen.add(key)
        places.append(
            {
                "name": name,
                "lng": round(el["lon"], 5),
                "lat": round(el["lat"], 5),
                "place": tags.get("place"),
            }
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({"places": places}, ensure_ascii=False))
    kinds: dict[str, int] = {}
    for p in places:
        kinds[p["place"]] = kinds.get(p["place"], 0) + 1
    print(f"完成: {len(places)} 个地名 {kinds} -> {OUT_PATH.name} "
          f"({OUT_PATH.stat().st_size/1024:.0f} KB), 耗时 {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
