import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import { Network } from "./model/network";
import { attachAutosave, loadFromLocalStorage, saveNow } from "./persist/storage";
import { installHeatLayer, toggleHeatLayer } from "./render/heatLayer";
import { BASE_STYLE, BEIJING_CENTER } from "./render/mapStyle";
import {
  installNetworkLayers,
  setEditingLineHighlight,
  updateNetworkLayers,
} from "./render/networkLayers";
import type { Landmark } from "./sim/engine";
import { DataGrid } from "./sim/grids";
import { SimClient } from "./sim/simClient";
import { installTrainLayer, TrainAnimator } from "./render/trainLayer";
import { createClockControl, SimClock } from "./ui/clock";
import { EditorState } from "./ui/editorState";
import { createLinePanel } from "./ui/linePanel";
import { buildSegmentPopup } from "./ui/segmentPopup";
import { buildStationPopup } from "./ui/stationPopup";

const mapContainer = document.getElementById("map")!;
const panelContainer = document.getElementById("panel")!;

const saved = loadFromLocalStorage();
const network = saved ? Network.fromJSON(saved) : new Network();
const editor = new EditorState();

/** 数据文件可能尚未生成(管线未跑),缺哪个就降级哪个 */
async function loadCityData(): Promise<{
  popGrid: DataGrid | null;
  attrGrid: DataGrid | null;
  landmarks: Landmark[];
}> {
  const base = `${import.meta.env.BASE_URL}data/beijing`;
  const [pop, attr, lm] = await Promise.allSettled([
    DataGrid.fetch(`${base}/demand_grid.bin`, `${base}/demand_grid.json`),
    DataGrid.fetch(`${base}/attraction_grid.bin`, `${base}/attraction_grid.json`),
    fetch(`${base}/landmarks.json`).then((r) => (r.ok ? r.json() : { landmarks: [] })),
  ]);
  for (const [name, result] of [["人口栅格", pop], ["吸引栅格", attr]] as const) {
    if (result.status === "rejected") console.warn(`${name}加载失败,客流将降级:`, result.reason);
  }
  return {
    popGrid: pop.status === "fulfilled" ? pop.value : null,
    attrGrid: attr.status === "fulfilled" ? attr.value : null,
    landmarks: lm.status === "fulfilled" ? (lm.value.landmarks as Landmark[]) : [],
  };
}

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

/** 点击点到线路区间的命中检测:返回该线上最近的区间号,或 null */
function segmentAt(
  point: { x: number; y: number },
  lineId: string,
  maxDistPx = 8,
): number | null {
  const line = network.getLine(lineId);
  if (!line) return null;
  let best: number | null = null;
  let bestD = maxDistPx;
  for (let k = 0; k + 1 < line.stationIds.length; k++) {
    const a = network.getStation(line.stationIds[k]!);
    const b = network.getStation(line.stationIds[k + 1]!);
    if (!a || !b) continue;
    const pa = map.project([a.lng, a.lat]);
    const pb = map.project([b.lng, b.lat]);
    const d = pointSegDist(point, pa, pb);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

function pointSegDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

map.on("load", async () => {
  const { popGrid, attrGrid, landmarks } = await loadCityData();
  const sim = new SimClient(network);
  sim.init(popGrid, attrGrid, landmarks);

  function openStationPopup(stationId: string): void {
    const station = network.getStation(stationId);
    if (!station) return;
    popup?.remove();
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: "260px" })
      .setLngLat([station.lng, station.lat])
      .setDOMContent(buildStationPopup(network, sim, stationId, () => popup?.remove()))
      .addTo(map);
  }

  function openSegmentPopup(lngLat: maplibregl.LngLat, lineId: string, seg: number): void {
    popup?.remove();
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
      .setLngLat(lngLat)
      .setDOMContent(buildSegmentPopup(network, sim, lineId, seg))
      .addTo(map);
  }

  installNetworkLayers(map, network);
  network.subscribe(() => updateNetworkLayers(map, network));
  if (popGrid) installHeatLayer(map, popGrid);

  // 列车动画:时刻表解析求值,时钟驱动
  installTrainLayer(map);
  const animator = new TrainAnimator(map, network);
  const clock = new SimClock();
  clock.onTick((minutes) => animator.render(minutes));
  clock.start();
  createClockControl(mapContainer, clock);
  animator.render(clock.minutes);

  createLinePanel(panelContainer, network, editor, sim, {
    onImport: (imported) => {
      // 导入是低频操作:落盘后整页重载,避免到处重连订阅
      saveNow(imported);
      location.reload();
    },
    onToggleHeat: popGrid ? () => toggleHeatLayer(map) : null,
  });

  editor.subscribe(() => {
    setEditingLineHighlight(map, editor.editingLineId);
    mapContainer.classList.toggle("editing", editor.editingLineId !== null);
    if (editor.editingLineId) popup?.remove();
  });

  map.on("click", (e: maplibregl.MapMouseEvent) => {
    const hitStation = stationAt(e.point);
    const editingLineId = editor.editingLineId;
    if (editingLineId) {
      const stationId = hitStation ?? network.addStation(e.lngLat.lng, e.lngLat.lat).id;
      network.appendStationToLine(editingLineId, stationId);
      return;
    }
    if (hitStation) {
      openStationPopup(hitStation);
      return;
    }
    // 车站没命中,试试线路区间
    for (const line of network.lines) {
      const seg = segmentAt(e.point, line.id);
      if (seg !== null) {
        openSegmentPopup(e.lngLat, line.id, seg);
        return;
      }
    }
  });
  map.on("mousemove", (e) => {
    if (editor.editingLineId) return;
    map.getCanvas().style.cursor = stationAt(e.point) ? "pointer" : "";
  });

  if (import.meta.env.DEV) {
    // 供浏览器端调试/端到端验证读取应用状态
    (window as unknown as Record<string, unknown>).__realsubway = {
      network,
      editor,
      map,
      sim,
      clock,
      animator,
    };
  }
});
