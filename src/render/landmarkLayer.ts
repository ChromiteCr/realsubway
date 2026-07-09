import type { Map as MlMap } from "maplibre-gl";
import type { Landmark } from "../sim/engine";
import { STATIONS_LAYER } from "./networkLayers";

export const LANDMARK_SOURCE = "landmarks";
export const LANDMARK_LAYER = "landmarks-layer";
export const LANDMARK_LABEL_LAYER = "landmarks-label-layer";

/**
 * 地标图层:用灰色圈标记会产生额外客流的地标(机场/火车站/景点等)。
 * 独立开关,默认隐藏,可与热力图同时显示。插在车站层之下,不挡车站点击。
 */
export function installLandmarkLayer(map: MlMap, landmarks: Landmark[]): void {
  map.addSource(LANDMARK_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: landmarks.map((l) => ({
        type: "Feature",
        properties: { name: l.name, hub: l.hub ? 1 : 0 },
        geometry: { type: "Point", coordinates: [l.lng, l.lat] },
      })),
    },
  });

  const before = map.getLayer(STATIONS_LAYER) ? STATIONS_LAYER : undefined;
  map.addLayer(
    {
      id: LANDMARK_LAYER,
      type: "circle",
      source: LANDMARK_SOURCE,
      layout: { visibility: "none" },
      paint: {
        // 枢纽(机场/火车站)圈更大
        "circle-radius": ["case", ["==", ["get", "hub"], 1], 12, 9],
        "circle-color": "rgba(130,130,130,0.15)",
        "circle-stroke-color": "#808080",
        "circle-stroke-width": 1.5,
      },
    },
    before,
  );
  map.addLayer(
    {
      id: LANDMARK_LABEL_LAYER,
      type: "symbol",
      source: LANDMARK_SOURCE,
      minzoom: 10.5,
      layout: {
        visibility: "none",
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#666666",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.2,
      },
    },
    before,
  );
}

export function toggleLandmarkLayer(map: MlMap): boolean {
  const visible = map.getLayoutProperty(LANDMARK_LAYER, "visibility") !== "none";
  const v = visible ? "none" : "visible";
  map.setLayoutProperty(LANDMARK_LAYER, "visibility", v);
  map.setLayoutProperty(LANDMARK_LABEL_LAYER, "visibility", v);
  return !visible;
}
