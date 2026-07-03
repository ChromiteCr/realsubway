"""从 OSM 提取北京地铁现网,输出前端 NetworkData(version 1)格式。

线路 = route=subway 关系(每条线有两个方向的关系,按 ref 分组取停站多的方向);
车站 = 关系里 role=stop 的节点,跨线同名且相距 <500m 的合并为换乘站。

用法: tools/.venv/bin/python tools/make_starter_network.py
产出: public/data/beijing/starter_network.json
"""

import json
import math
import time
from pathlib import Path

from overpass import query

OUT_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "beijing" / "starter_network.json"

MERGE_DISTANCE_M = 500

# 与 src/config/rollingstock.ts 的 defaultServicePlan 保持一致
def default_service_plan() -> dict:
    headway = [6] * 24
    for h in (7, 8, 17, 18):
        headway[h] = 3
    return {
        "firstTrainMin": 330,
        "lastTrainMin": 1380,
        "headwayByHour": headway,
        "stock": {"type": "B", "cars": 6},
    }


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    rad = math.pi / 180
    dlat = (b[1] - a[1]) * rad
    dlng = (b[0] - a[0]) * rad
    s = math.sin(dlat / 2) ** 2 + math.cos(a[1] * rad) * math.cos(b[1] * rad) * math.sin(dlng / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(s))


def fetch() -> tuple[list[dict], list[dict], dict[int, dict]]:
    ql = """
[out:json][timeout:240];
relation["route"="subway"]["network"~"北京"]->.r;
.r out body;
node(r.r);
out body qt;
relation["route_master"="subway"]["network"~"北京"];
out body;
"""
    data = query(ql)
    routes = [el for el in data["elements"] if el["type"] == "relation" and el.get("tags", {}).get("route") == "subway"]
    masters = [el for el in data["elements"] if el["type"] == "relation" and el.get("tags", {}).get("route_master") == "subway"]
    nodes = {el["id"]: el for el in data["elements"] if el["type"] == "node"}
    return routes, masters, nodes


def clean_line_name(tags: dict) -> str:
    """"北京地铁1号线/八通线" -> "1号线/八通线";无 name 时用 ref 兜底"""
    name = tags.get("name:zh", "") or tags.get("name", "")
    for prefix in ("北京地铁", "地铁 ", "地铁"):
        if name.startswith(prefix):
            name = name[len(prefix):]
            break
    name = name.strip()
    if not name:
        ref = tags.get("ref", "?")
        name = f"{ref}号线" if ref.isdigit() else ref
    return name


def main() -> None:
    routes, masters, nodes = fetch()
    print(f"取到 {len(routes)} 个方向关系, {len(masters)} 个 route_master, {len(nodes)} 个节点")

    # 方向关系 -> 所属 route_master(规范的线名/颜色都在 master 上)
    master_of: dict[int, dict] = {}
    for m in masters:
        for member in m.get("members", []):
            if member["type"] == "relation":
                master_of[member["ref"]] = m

    # 按线路分组(优先 master,无 master 时退回 ref/name),取停站多的方向
    grouped: dict[str, dict] = {}
    for rel in routes:
        tags = rel.get("tags", {})
        master = master_of.get(rel["id"])
        group_tags = master.get("tags", {}) if master else tags
        key = f"m{master['id']}" if master else (tags.get("ref") or tags.get("name", f"rel{rel['id']}"))
        stop_ids = [m["ref"] for m in rel.get("members", []) if m["type"] == "node" and m.get("role") == "stop"]
        stops = [nodes[i] for i in stop_ids if i in nodes]
        cur = grouped.get(key)
        if cur is None or len(stops) > len(cur["stops"]):
            grouped[key] = {"tags": group_tags, "route_tags": tags, "stops": stops}

    # 合并跨线的同名近距站
    stations: list[dict] = []  # {id,name,lng,lat}
    def station_id_for(node: dict) -> str | None:
        name = node.get("tags", {}).get("name", "").strip()
        if not name:
            return None
        pos = (node["lon"], node["lat"])
        for st in stations:
            if st["name"] == name and haversine_m((st["lng"], st["lat"]), pos) < MERGE_DISTANCE_M:
                return st["id"]
        st = {"id": f"s{len(stations)+1}", "name": name, "lng": node["lon"], "lat": node["lat"]}
        stations.append(st)
        return st["id"]

    entries = sorted(grouped.values(), key=lambda e: clean_line_name(e["tags"]))
    lines = []
    for entry in entries:
        tags = entry["tags"]
        sids: list[str] = []
        for node in entry["stops"]:
            sid = station_id_for(node)
            if sid and (not sids or sids[-1] != sid):
                sids.append(sid)
        name = clean_line_name(tags)
        if len(sids) < 2:
            print(f"  跳过 {name}(有效站 <2)")
            continue
        color = tags.get("colour") or entry["route_tags"].get("colour") or "#888888"
        lines.append({
            "id": f"l{len(lines)+1}",
            "name": name,
            "color": color,
            "stationIds": sids,
            "servicePlan": default_service_plan(),
        })
        print(f"  {name}: {len(sids)} 站, 颜色 {color}")

    # 贯通运营在 OSM 里既有合并线又有子线(如 1号线/八通线 与 八通线),去掉被包含的子集
    kept = []
    for line in lines:
        s = set(line["stationIds"])
        subset_of = next(
            (o["name"] for o in lines if o is not line and s < set(o["stationIds"])), None
        )
        if subset_of:
            print(f"  去除子集线 {line['name']}(包含于 {subset_of})")
        else:
            kept.append(line)
    for i, line in enumerate(kept, start=1):
        line["id"] = f"l{i}"
    lines = kept

    # 去掉不再被任何线路引用的站
    used = {sid for line in lines for sid in line["stationIds"]}
    stations = [st for st in stations if st["id"] in used]

    network = {"version": 1, "stations": stations, "lines": lines}
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(network, ensure_ascii=False))
    print(f"完成: {len(lines)} 条线, {len(stations)} 个站 -> {OUT_PATH.name} "
          f"({OUT_PATH.stat().st_size/1024:.0f} KB), {time.strftime('%H:%M:%S')}")


if __name__ == "__main__":
    main()
