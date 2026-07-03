"""从 OSM POI 生成就业/出行吸引栅格。

按类别分别查询 Overpass(out skel center 不带标签,响应小),
以类别权重做 2D 直方图,再高斯平滑,量化为 Uint16。
内存峰值 = 最大一次 JSON 响应(几十 MB)+ 网格,远低于 1GB。

用法: tools/.venv/bin/python tools/make_attraction_grid.py
产出: public/data/beijing/attraction_grid.bin + attraction_grid.json
"""

import json
import time
from pathlib import Path

import numpy as np

from gridspec import HEIGHT, LAT_MAX, LAT_MIN, LNG_MAX, LNG_MIN, WIDTH, frame_meta
from overpass import query

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "data" / "beijing"

BBOX = f"{LAT_MIN},{LNG_MIN},{LAT_MAX},{LNG_MAX}"

# 类别 -> (Overpass 过滤器, 权重)。权重≈该类 POI 代表的相对就业/客流吸引强度
CATEGORIES = {
    "office": ('["office"]', 4.0),
    "commercial_building": ('["building"~"^(office|commercial|retail)$"]', 3.0),
    "shop": ('["shop"]', 1.0),
    "food": ('["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]', 1.0),
    "education": ('["amenity"~"^(university|college|school)$"]', 2.0),
    "health": ('["amenity"~"^(hospital|clinic)$"]', 2.0),
    "industrial": ('["landuse"="industrial"]', 3.0),
}

GAUSS_SIGMA_CELLS = 2.0


def fetch_centers(filter_ql: str) -> np.ndarray:
    """返回 (N,2) 数组 [lng, lat];way/relation 取 center。"""
    ql = f"""
[out:json][timeout:180][bbox:{BBOX}];
( node{filter_ql}; way{filter_ql}; relation{filter_ql}; );
out skel center qt;
"""
    data = query(ql)
    pts = []
    for el in data.get("elements", []):
        if "lat" in el:
            pts.append((el["lon"], el["lat"]))
        elif "center" in el:
            pts.append((el["center"]["lon"], el["center"]["lat"]))
    return np.array(pts, dtype=np.float64).reshape(-1, 2)


def gaussian_blur(grid: np.ndarray, sigma: float) -> np.ndarray:
    """可分离高斯卷积,仅用 numpy。"""
    radius = int(3 * sigma)
    x = np.arange(-radius, radius + 1)
    kernel = np.exp(-(x**2) / (2 * sigma**2))
    kernel /= kernel.sum()
    blurred = np.apply_along_axis(lambda r: np.convolve(r, kernel, mode="same"), 1, grid)
    blurred = np.apply_along_axis(lambda c: np.convolve(c, kernel, mode="same"), 0, blurred)
    return blurred


def main() -> None:
    t0 = time.time()
    grid = np.zeros((HEIGHT, WIDTH), dtype=np.float64)
    stats = {}

    for name, (filter_ql, weight) in CATEGORIES.items():
        pts = fetch_centers(filter_ql)
        stats[name] = len(pts)
        print(f"{name}: {len(pts)} 个 POI (权重 {weight})")
        if len(pts) == 0:
            continue
        # 行 0 = 北:lat 越大行号越小
        cols = ((pts[:, 0] - LNG_MIN) / (LNG_MAX - LNG_MIN) * WIDTH).astype(int)
        rows = ((LAT_MAX - pts[:, 1]) / (LAT_MAX - LAT_MIN) * HEIGHT).astype(int)
        ok = (cols >= 0) & (cols < WIDTH) & (rows >= 0) & (rows < HEIGHT)
        np.add.at(grid, (rows[ok], cols[ok]), weight)
        time.sleep(3)  # 对 Overpass 客气一点

    grid = gaussian_blur(grid, GAUSS_SIGMA_CELLS)

    # 量化:满量程映射到 Uint16,scale 记录在 meta 里
    peak = float(grid.max())
    scale = peak / 65535.0 if peak > 0 else 1.0
    out = np.round(grid / scale).astype("<u2")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "attraction_grid.bin").write_bytes(out.tobytes())
    meta = frame_meta() | {
        "kind": "attraction",
        "scale": scale,
        "totalWeight": round(float(grid.sum())),
        "poiCounts": stats,
        "source": "OSM via Overpass, POI 类别加权直方图 + 高斯平滑",
        "generated": time.strftime("%Y-%m-%d"),
    }
    (OUT_DIR / "attraction_grid.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print(f"完成: 总权重 {grid.sum():.0f}, 耗时 {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
