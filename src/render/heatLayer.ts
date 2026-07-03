import type { Map as MlMap } from "maplibre-gl";
import type { DataGrid } from "../sim/grids";
import { LINES_EDIT_LAYER } from "./networkLayers";

export const HEAT_SOURCE = "demand-heat";
export const HEAT_LAYER = "demand-heat-layer";

/** 把需求栅格画成半透明热力图片,插在线网图层下面 */
export function installHeatLayer(map: MlMap, grid: DataGrid): void {
  const { width, height, bbox } = grid.meta;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);

  // 用 99 分位做归一化上限,避免极端格把整张图压暗
  const sorted = Array.from(grid.data).sort((a, b) => a - b);
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 1;

  for (let i = 0; i < grid.data.length; i++) {
    const t = Math.min(1, grid.data[i]! / p99);
    // 透明 → 黄 → 红
    img.data[i * 4] = Math.round(255 * Math.min(1, t * 1.6));
    img.data[i * 4 + 1] = Math.round(200 * (1 - t * t));
    img.data[i * 4 + 2] = 40;
    img.data[i * 4 + 3] = Math.round(210 * Math.sqrt(t));
  }
  ctx.putImageData(img, 0, 0);

  map.addSource(HEAT_SOURCE, {
    type: "image",
    url: canvas.toDataURL(),
    coordinates: [
      [bbox.lngMin, bbox.latMax],
      [bbox.lngMax, bbox.latMax],
      [bbox.lngMax, bbox.latMin],
      [bbox.lngMin, bbox.latMin],
    ],
  });
  map.addLayer(
    {
      id: HEAT_LAYER,
      type: "raster",
      source: HEAT_SOURCE,
      paint: { "raster-opacity": 0.55, "raster-resampling": "nearest" },
      layout: { visibility: "none" },
    },
    LINES_EDIT_LAYER,
  );
}

export function toggleHeatLayer(map: MlMap): boolean {
  const visible = map.getLayoutProperty(HEAT_LAYER, "visibility") !== "none";
  map.setLayoutProperty(HEAT_LAYER, "visibility", visible ? "none" : "visible");
  return !visible;
}
