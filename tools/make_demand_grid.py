"""从 WorldPop 中国 2020 人口栅格(100m,全国 4.6GB)生成北京需求网格。

数据源优先级:
1. tools/raw/chn_ppp_2020.tif(如果已手动下载)
2. WorldPop FTP 远程窗口读取——HTTP 端不支持范围请求,但 FTP 支持 REST,
   GDAL /vsicurl 只拉取北京窗口覆盖的行条带(约几十 MB 传输)。
内存峰值百 MB 量级。

用法: tools/.venv/bin/python tools/make_demand_grid.py
产出: public/data/beijing/demand_grid.bin + demand_grid.json
"""

import json
import os
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds

from gridspec import HEIGHT, LAT_MAX, LAT_MIN, LNG_MAX, LNG_MIN, WIDTH, frame_meta

LOCAL_TIF = Path(__file__).resolve().parent / "raw" / "chn_ppp_2020.tif"
FTP_URL = "/vsicurl/ftp://ftp.worldpop.org/GIS/Population/Global_2000_2020/2020/CHN/chn_ppp_2020.tif"

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "data" / "beijing"


def overlap_weights(src_centers: np.ndarray, n_dst: int, dst_span: float) -> np.ndarray:
    """一维守恒重采样权重 w[t, s] = 源像素 s 落进目标格 t 的长度占比。

    源(WorldPop 100m ≈ 0.000833°)与目标格(0.8°/512 ≈ 0.0015625°)之比是
    1.875 / 1.78 这样的非整数,若像早期版本那样"每个源像素按中心点归入唯一
    目标格",就会周期性地出现只吃到 1 个源像素(而邻居吃到 2 个)的目标格,
    在热力图上表现为格子状条纹(列周期 8、行周期约 4.6)。按重叠长度分摊,
    每个目标格积分的是自己那块面积上的真实人口,条纹随之消失。

    权重按源像素归一化(每列和为 1),因此总人口守恒;完全落在网格外的源
    像素为全零列,只被网格切到一半的像素把整份人口留给相交的目标格。
    """
    step = abs(src_centers[1] - src_centers[0])
    src_lo = src_centers - step / 2
    src_hi = src_centers + step / 2
    dst_edges = np.linspace(0.0, dst_span, n_dst + 1)
    lo = np.maximum(src_lo[None, :], dst_edges[:-1, None])
    hi = np.minimum(src_hi[None, :], dst_edges[1:, None])
    w = np.clip(hi - lo, 0.0, None)
    colsum = w.sum(axis=0)
    np.divide(w, colsum, out=w, where=colsum > 0)
    return w


def main() -> None:
    if LOCAL_TIF.exists():
        source = str(LOCAL_TIF)
    else:
        source = FTP_URL
        os.environ.setdefault("GDAL_HTTP_TIMEOUT", "180")
        os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "5")
        os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "5")
        # 大块连续读,减少 FTP 往返(行条带在文件里是连续的)
        os.environ.setdefault("CPL_VSIL_CURL_CHUNK_SIZE", str(10 * 1024 * 1024))
        os.environ.setdefault("CPL_VSIL_CURL_CACHE_SIZE", str(256 * 1024 * 1024))
    print(f"数据源: {source}")

    t0 = time.time()
    cache = LOCAL_TIF.parent / "beijing_window.npz"
    if cache.exists():
        cached = np.load(cache)
        data, lngs, lats = cached["data"], cached["lngs"], cached["lats"]
        print(f"使用缓存窗口 {cache.name}: {data.shape}")
    else:
        with rasterio.open(source) as src:
            print(f"打开栅格: {src.width}x{src.height}, nodata={src.nodata}")
            window = from_bounds(LNG_MIN, LAT_MIN, LNG_MAX, LAT_MAX, src.transform)
            data = src.read(1, window=window)  # 原生 100m 分辨率
            tr = src.window_transform(window)
        data = np.nan_to_num(data, nan=0.0)
        data[data < 0] = 0  # nodata 是大负数
        # 源像素中心经纬度
        lngs = tr.c + (np.arange(data.shape[1]) + 0.5) * tr.a
        lats = tr.f + (np.arange(data.shape[0]) + 0.5) * tr.e
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cache, data=data, lngs=lngs, lats=lats)

    # 守恒面积加权重采样(见 overlap_weights 的注释:按中心点归格会出条纹)
    src_x = lngs - LNG_MIN
    src_y = LAT_MAX - lats  # 向南为正,与 row 同向
    w_col = overlap_weights(src_x, WIDTH, LNG_MAX - LNG_MIN)
    w_row = overlap_weights(src_y, HEIGHT, LAT_MAX - LAT_MIN)
    grid_f = w_row @ data.astype(np.float64) @ w_col.T

    total = float(grid_f.sum())
    peak = float(grid_f.max())
    # 与网格无重叠的源像素(窗口比 bbox 多出的半像素边)不计入,其余必须守恒
    inside = float((data.astype(np.float64) * (w_row.sum(0)[:, None] * w_col.sum(0)[None, :])).sum())
    if abs(total - inside) > 1:
        raise SystemExit(f"聚合不守恒: {total} != {inside}")
    print(f"窗口边缘落在网格外的人口: {float(data.sum()) - inside:.0f} 人")
    if peak > 65535:
        raise SystemExit(f"单格人口 {peak:.0f} 超出 Uint16,需要缩放因子")

    grid = np.round(grid_f).astype("<u2")  # little-endian uint16

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "demand_grid.bin").write_bytes(grid.tobytes())
    meta = frame_meta() | {
        "kind": "population",
        "totalPopulation": round(total),
        "maxCell": round(peak),
        "source": "WorldPop chn_ppp_2020 (100m, unconstrained), windowed read",
        "generated": time.strftime("%Y-%m-%d"),
    }
    (OUT_DIR / "demand_grid.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))

    print(f"完成: 总人口 {total/1e6:.2f}M, 最大格 {peak:.0f} 人, 耗时 {time.time()-t0:.0f}s")
    print(f"输出: {OUT_DIR}/demand_grid.bin ({grid.nbytes/1024:.0f} KB)")


if __name__ == "__main__":
    main()
