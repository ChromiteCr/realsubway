import type { Feature, FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { Network } from "../model/network";

export const LINES_SOURCE = "net-lines";
export const STATIONS_SOURCE = "net-stations";
export const LINES_LAYER = "net-lines-layer";
export const LINES_EDIT_LAYER = "net-lines-edit-layer";
export const STATIONS_LAYER = "net-stations-layer";
export const STATION_LABELS_LAYER = "net-station-labels";

function linesGeoJSON(network: Network): FeatureCollection {
  const features: Feature[] = [];
  for (const line of network.lines) {
    const coords = line.stationIds
      .map((sid) => network.getStation(sid))
      .filter((s) => s !== undefined)
      .map((s) => [s.lng, s.lat]);
    if (coords.length < 2) continue;
    features.push({
      type: "Feature",
      properties: { id: line.id, color: line.color },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  return { type: "FeatureCollection", features };
}

function stationsGeoJSON(network: Network): FeatureCollection {
  const features: Feature[] = network.stations.map((s) => ({
    type: "Feature",
    properties: {
      id: s.id,
      name: s.name,
      lineCount: network.linesThroughStation(s.id).length,
    },
    geometry: { type: "Point", coordinates: [s.lng, s.lat] },
  }));
  return { type: "FeatureCollection", features };
}

/** 安装线网图层;线在下、站在上、站名最上 */
export function installNetworkLayers(map: MlMap, network: Network): void {
  map.addSource(LINES_SOURCE, { type: "geojson", data: linesGeoJSON(network) });
  map.addSource(STATIONS_SOURCE, { type: "geojson", data: stationsGeoJSON(network) });

  // 正在编辑的线路下方的高亮衬底,filter 由 setEditingLine 控制
  map.addLayer({
    id: LINES_EDIT_LAYER,
    type: "line",
    source: LINES_SOURCE,
    filter: ["==", ["get", "id"], ""],
    paint: { "line-color": ["get", "color"], "line-width": 12, "line-opacity": 0.25 },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: LINES_LAYER,
    type: "line",
    source: LINES_SOURCE,
    paint: { "line-color": ["get", "color"], "line-width": 4 },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: STATIONS_LAYER,
    type: "circle",
    source: STATIONS_SOURCE,
    paint: {
      "circle-radius": ["case", [">=", ["get", "lineCount"], 2], 7, 5],
      "circle-color": "#ffffff",
      "circle-stroke-color": "#333333",
      "circle-stroke-width": ["case", [">=", ["get", "lineCount"], 2], 2.5, 1.5],
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

export function updateNetworkLayers(map: MlMap, network: Network): void {
  (map.getSource(LINES_SOURCE) as GeoJSONSource).setData(linesGeoJSON(network));
  (map.getSource(STATIONS_SOURCE) as GeoJSONSource).setData(stationsGeoJSON(network));
}

export function setEditingLineHighlight(map: MlMap, lineId: string | null): void {
  map.setFilter(LINES_EDIT_LAYER, ["==", ["get", "id"], lineId ?? ""]);
}
