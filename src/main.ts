import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import { Network } from "./model/network";
import { buildGazetteer, type Gazetteer } from "./model/naming";
import type { StationData } from "./model/types";
import { attachAutosave, loadFromLocalStorage, saveNow } from "./persist/storage";
import { installHeatLayer, toggleHeatLayer } from "./render/heatLayer";
import { installLandmarkLayer, toggleLandmarkLayer } from "./render/landmarkLayer";
import { segmentCurves } from "./render/lineGeometry";
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
import { createEditHint } from "./ui/editHint";
import { EditorState } from "./ui/editorState";
import { createLinePanel } from "./ui/linePanel";
import { createRankingPanel } from "./ui/rankingPanel";
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

/** 车站自动取名的地名索引:真实站名 + 地标 + OSM 片区名;任一来源缺失优雅降级 */
async function loadGazetteer(landmarks: Landmark[]): Promise<Gazetteer> {
  const base = `${import.meta.env.BASE_URL}data/beijing`;
  const [places, starter] = await Promise.allSettled([
    fetch(`${base}/placenames.json`).then((r) => (r.ok ? r.json() : { places: [] })),
    fetch(`${base}/starter_network.json`).then((r) => (r.ok ? r.json() : { stations: [] })),
  ]);
  return buildGazetteer({
    stations: starter.status === "fulfilled" ? starter.value.stations : [],
    landmarks,
    places: places.status === "fulfilled" ? places.value.places : [],
  });
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

/**
 * 点击点到线路区间的命中检测:返回该线上最近的区间号,或 null。
 * 沿曲线折线判距(与渲染一致);略放宽阈值以容纳 line-offset 的像素偏移。
 */
function segmentAt(
  point: { x: number; y: number },
  lineId: string,
  maxDistPx = 10,
): number | null {
  const line = network.getLine(lineId);
  if (!line) return null;
  const pos = line.stationIds
    .map((sid) => network.getStation(sid))
    .filter((s): s is StationData => s !== undefined)
    .map((s): [number, number] => [s.lng, s.lat]);
  if (pos.length < 2) return null;
  const curves = segmentCurves(pos);
  let best: number | null = null;
  let bestD = maxDistPx;
  for (let k = 0; k < curves.length; k++) {
    const curve = curves[k]!;
    for (let i = 0; i + 1 < curve.length; i++) {
      const pa = map.project([curve[i]![0]!, curve[i]![1]!]);
      const pb = map.project([curve[i + 1]![0]!, curve[i + 1]![1]!]);
      const d = pointSegDist(point, pa, pb);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
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
  const gazetteer = await loadGazetteer(landmarks);
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

  /** 编辑中线路的活动/闲置端点站(用于视觉标记) */
  function currentEnds() {
    const lid = editor.editingLineId;
    const line = lid ? network.getLine(lid) : undefined;
    if (!line || line.stationIds.length === 0) {
      return { activeStationId: null, otherStationId: null };
    }
    const head = line.stationIds[0]!;
    const tail = line.stationIds[line.stationIds.length - 1]!;
    return editor.activeEnd === "head"
      ? { activeStationId: head, otherStationId: tail }
      : { activeStationId: tail, otherStationId: head };
  }
  function refreshLayers(): void {
    updateNetworkLayers(map, network, currentEnds());
  }

  /** 在给定位置建站,自动取名(M4X) */
  function createStationAt(lngLat: maplibregl.LngLat) {
    const existing = new Set(network.stations.map((s) => s.name));
    const suggested = gazetteer.suggest(lngLat.lng, lngLat.lat, existing) ?? undefined;
    return network.addStation(lngLat.lng, lngLat.lat, suggested);
  }

  installNetworkLayers(map, network);
  network.subscribe(refreshLayers);
  if (popGrid) installHeatLayer(map, popGrid);
  installLandmarkLayer(map, landmarks);

  // 列车动画:时刻表解析求值,时钟驱动
  installTrainLayer(map);
  const animator = new TrainAnimator(map, network);
  const clock = new SimClock();
  clock.onTick((minutes) => animator.render(minutes));
  clock.start();
  createClockControl(mapContainer, clock);
  animator.render(clock.minutes);
  createEditHint(mapContainer, network, editor);
  createRankingPanel(mapContainer, network, sim);

  createLinePanel(panelContainer, network, editor, sim, {
    onImport: (imported) => {
      // 导入是低频操作:落盘后整页重载,避免到处重连订阅
      saveNow(imported);
      location.reload();
    },
    onToggleHeat: popGrid ? () => toggleHeatLayer(map) : null,
    onToggleLandmarks: landmarks.length > 0 ? () => toggleLandmarkLayer(map) : null,
  });

  editor.subscribe(() => {
    setEditingLineHighlight(map, editor.editingLineId);
    mapContainer.classList.toggle("editing", editor.editingLineId !== null);
    if (editor.editingLineId) popup?.remove();
    refreshLayers();
  });

  // —— 铺设模式的拖拽移动车站(M5a1)——
  let drag: { stationId: string; moved: boolean } | null = null;
  let suppressClick = false;

  map.on("mousedown", (e: maplibregl.MapMouseEvent) => {
    if (!editor.editingLineId) return; // 拖拽移动仅在铺设模式
    const sid = stationAt(e.point);
    if (!sid) return;
    e.preventDefault(); // 阻止地图平移
    drag = { stationId: sid, moved: false };
  });
  map.on("mousemove", (e: maplibregl.MapMouseEvent) => {
    if (drag) {
      drag.moved = true;
      network.moveStation(drag.stationId, e.lngLat.lng, e.lngLat.lat);
      return;
    }
    if (editor.editingLineId) {
      map.getCanvas().style.cursor = stationAt(e.point) ? "move" : "crosshair";
    } else {
      map.getCanvas().style.cursor = stationAt(e.point) ? "pointer" : "";
    }
  });
  map.on("mouseup", () => {
    if (!drag) return;
    if (drag.moved) suppressClick = true; // 拖动后抑制随之而来的 click
    drag = null;
  });

  /** 铺设模式下处理点击:切换生长端 / 中插 / 端点延长 */
  function handleEditingClick(
    lineId: string,
    hit: string | null,
    lngLat: maplibregl.LngLat,
    point: maplibregl.Point,
  ): void {
    const line = network.getLine(lineId);
    if (!line) return;
    const head = line.stationIds[0];
    const tail = line.stationIds[line.stationIds.length - 1];
    // 点线路端点站 → 切换生长端
    if (hit && head !== tail && hit === head) return editor.setActiveEnd("head");
    if (hit && head !== tail && hit === tail) return editor.setActiveEnd("tail");
    // 点本线中部区段(未命中车站)→ 在该处插站
    const seg = segmentAt(point, lineId);
    if (!hit && seg !== null) {
      const st = createStationAt(lngLat);
      network.insertStationInLine(lineId, st.id, seg + 1);
      editor.setLastLaid(st.id);
      return;
    }
    // 点到本线已有的中间站 → 忽略(避免自连)
    if (hit && line.stationIds.includes(hit)) return;
    // 否则在活动端生长(hit 为他线车站则成换乘)
    const stationId = hit ?? createStationAt(lngLat).id;
    const ok =
      editor.activeEnd === "head"
        ? network.prependStationToLine(lineId, stationId)
        : network.appendStationToLine(lineId, stationId);
    if (ok) editor.setLastLaid(stationId);
  }

  map.on("click", (e: maplibregl.MapMouseEvent) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const hitStation = stationAt(e.point);
    const editingLineId = editor.editingLineId;
    if (editingLineId) {
      handleEditingClick(editingLineId, hitStation, e.lngLat, e.point);
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

  if (import.meta.env.DEV) {
    // 供浏览器端调试/端到端验证读取应用状态
    (window as unknown as Record<string, unknown>).__realsubway = {
      network,
      editor,
      map,
      sim,
      clock,
      animator,
      gazetteer,
    };
  }
});
