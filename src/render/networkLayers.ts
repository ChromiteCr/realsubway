import type { Feature, FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { Network } from "../model/network";
import { buildLineFeatures } from "./lineGeometry";

export const LINES_SOURCE = "net-lines";
export const STATIONS_SOURCE = "net-stations";
export const LINES_LAYER = "net-lines-layer";
export const LINES_EDIT_LAYER = "net-lines-edit-layer";
export const STATIONS_LAYER = "net-stations-layer";
export const STATION_LABELS_LAYER = "net-station-labels";

/** 编辑中线路的活动生长端点(head/tail 对应的站 id),供视觉标记 */
export interface ActiveEndpoints {
  activeStationId: string | null;
  otherStationId: string | null;
}

function stationsGeoJSON(network: Network, ends: ActiveEndpoints): FeatureCollection {
  const features: Feature[] = network.stations.map((s) => ({
    type: "Feature",
    properties: {
      id: s.id,
      name: s.name,
      lineCount: network.linesThroughStation(s.id).length,
      endpoint: s.id === ends.activeStationId ? "active" : s.id === ends.otherStationId ? "idle" : "",
    },
    geometry: { type: "Point", coordinates: [s.lng, s.lat] },
  }));
  return { type: "FeatureCollection", features };
}

const NO_ENDS: ActiveEndpoints = { activeStationId: null, otherStationId: null };

/** 安装线网图层;线在下、站在上、站名最上 */
export function installNetworkLayers(map: MlMap, network: Network): void {
  map.addSource(LINES_SOURCE, { type: "geojson", data: buildLineFeatures(network) });
  map.addSource(STATIONS_SOURCE, { type: "geojson", data: stationsGeoJSON(network, NO_ENDS) });

  // 正在编辑的线路下方的高亮衬底,filter 由 setEditingLine 控制
  map.addLayer({
    id: LINES_EDIT_LAYER,
    type: "line",
    source: LINES_SOURCE,
    filter: ["==", ["get", "id"], ""],
    paint: {
      "line-color": ["get", "color"],
      "line-width": 12,
      "line-opacity": 0.25,
      "line-offset": ["get", "offset"],
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: LINES_LAYER,
    type: "line",
    source: LINES_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 4,
      "line-offset": ["get", "offset"],
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: STATIONS_LAYER,
    type: "circle",
    source: STATIONS_SOURCE,
    paint: {
      "circle-radius": [
        "case",
        ["==", ["get", "endpoint"], "active"],
        8,
        [">=", ["get", "lineCount"], 2],
        7,
        5,
      ],
      "circle-color": ["case", ["==", ["get", "endpoint"], "active"], "#2f6fb3", "#ffffff"],
      "circle-stroke-color": [
        "case",
        ["==", ["get", "endpoint"], "active"],
        "#ffffff",
        ["==", ["get", "endpoint"], "idle"],
        "#2f6fb3",
        "#333333",
      ],
      "circle-stroke-width": [
        "case",
        ["!=", ["get", "endpoint"], ""],
        3,
        [">=", ["get", "lineCount"], 2],
        2.5,
        1.5,
      ],
    },
  });
  map.addLayer({
    id: STATION_LABELS_LAYER,
    type: "symbol",
    source: STATIONS_SOURCE,
    minzoom: 11,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#333333",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
    },
  });
}

export function updateNetworkLayers(
  map: MlMap,
  network: Network,
  ends: ActiveEndpoints = NO_ENDS,
): void {
  (map.getSource(LINES_SOURCE) as GeoJSONSource).setData(buildLineFeatures(network));
  (map.getSource(STATIONS_SOURCE) as GeoJSONSource).setData(stationsGeoJSON(network, ends));
}

export function setEditingLineHighlight(map: MlMap, lineId: string | null): void {
  map.setFilter(LINES_EDIT_LAYER, ["==", ["get", "id"], lineId ?? ""]);
}
