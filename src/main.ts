import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import { Network } from "./model/network";
import { attachAutosave, loadFromLocalStorage, saveNow } from "./persist/storage";
import { BASE_STYLE, BEIJING_CENTER } from "./render/mapStyle";
import {
  installNetworkLayers,
  setEditingLineHighlight,
  updateNetworkLayers,
} from "./render/networkLayers";
import { EditorState } from "./ui/editorState";
import { createLinePanel } from "./ui/linePanel";
import { buildStationPopup } from "./ui/stationPopup";

const mapContainer = document.getElementById("map")!;
const panelContainer = document.getElementById("panel")!;

const saved = loadFromLocalStorage();
const network = saved ? Network.fromJSON(saved) : new Network();
const editor = new EditorState();

const map = new maplibregl.Map({
  container: mapContainer,
  style: BASE_STYLE,
  center: BEIJING_CENTER,
  zoom: 11,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

attachAutosave(network);

/**
 * 车站命中检测:对模型投影到屏幕坐标找最近站。
 * 不用 queryRenderedFeatures——它依赖渲染完成,快速连点时新站尚未渲染,会漏检导致重复建站。
 */
function stationAt(point: { x: number; y: number }): string | null {
  const hitRadiusPx = 10;
  let best: string | null = null;
  let bestDist = hitRadiusPx;
  for (const s of network.stations) {
    const p = map.project([s.lng, s.lat]);
    const d = Math.hypot(p.x - point.x, p.y - point.y);
    if (d < bestDist) {
      bestDist = d;
      best = s.id;
    }
  }
  return best;
}

let popup: maplibregl.Popup | null = null;

function openStationPopup(stationId: string): void {
  const station = network.getStation(stationId);
  if (!station) return;
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" })
    .setLngLat([station.lng, station.lat])
    .setDOMContent(buildStationPopup(network, stationId, () => popup?.remove()))
    .addTo(map);
}

function handleMapClick(e: maplibregl.MapMouseEvent): void {
  const hitStation = stationAt(e.point);
  const editingLineId = editor.editingLineId;

  if (editingLineId) {
    const stationId = hitStation ?? network.addStation(e.lngLat.lng, e.lngLat.lat).id;
    network.appendStationToLine(editingLineId, stationId);
    return;
  }
  if (hitStation) openStationPopup(hitStation);
}

map.on("load", () => {
  installNetworkLayers(map, network);
  network.subscribe(() => updateNetworkLayers(map, network));

  createLinePanel(panelContainer, network, editor, {
    onImport: (imported) => {
      // 导入是低频操作:落盘后整页重载,避免到处重连订阅
      saveNow(imported);
      location.reload();
    },
  });

  editor.subscribe(() => {
    setEditingLineHighlight(map, editor.editingLineId);
    mapContainer.classList.toggle("editing", editor.editingLineId !== null);
    if (editor.editingLineId) popup?.remove();
  });

  map.on("click", handleMapClick);
  map.on("mousemove", (e) => {
    if (editor.editingLineId) return;
    map.getCanvas().style.cursor = stationAt(e.point) ? "pointer" : "";
  });
});

if (import.meta.env.DEV) {
  // 供浏览器端调试/端到端验证读取应用状态
  (window as unknown as Record<string, unknown>).__realsubway = { network, editor, map };
}
