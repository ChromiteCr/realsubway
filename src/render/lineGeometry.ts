import type { Feature, FeatureCollection, Position } from "geojson";
import { haversineKm } from "../model/geo";
import type { Network } from "../model/network";
import type { StationData } from "../model/types";

/** 平行轨道间距(像素),用于 MapLibre line-offset */
const TRACK_SPACING_PX = 5;
/** 每个区段的曲线采样点数(不含起点) */
const CURVE_SAMPLES = 10;

/** 规范化区段键:两端站 id 排序,方向无关 */
function segKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * 共享区段分析:每个规范化区段 → 使用它的线路 id 列表(按 id 排序,稳定槽位)。
 * 两条线有 2+ 连续换乘站即形成共享区段,据此把并行线路错开。
 */
function computeBundles(network: Network): Map<string, string[]> {
  const bundles = new Map<string, string[]>();
  for (const line of network.lines) {
    for (let k = 0; k + 1 < line.stationIds.length; k++) {
      const a = line.stationIds[k]!;
      const b = line.stationIds[k + 1]!;
      if (a === b) continue;
      const key = segKey(a, b);
      let list = bundles.get(key);
      if (!list) {
        list = [];
        bundles.set(key, list);
      }
      if (!list.includes(line.id)) list.push(line.id);
    }
  }
  for (const list of bundles.values()) list.sort();
  return bundles;
}

/**
 * 线路在某区段(a→b)上的 line-offset(像素)。
 * 槽位居中分布;规范化方向(a<b)定正负,使双向经过同一区段的线也几何一致。
 */
function offsetFor(lineId: string, a: string, b: string, bundles: Map<string, string[]>): number {
  const list = bundles.get(segKey(a, b));
  if (!list || list.length < 2) return 0;
  const slot = list.indexOf(lineId);
  const c = (slot - (list.length - 1) / 2) * TRACK_SPACING_PX;
  return a < b ? c : -c;
}

/** 向心 Catmull-Rom(alpha=0.5),避免尖角处过冲成环 */
function centripetalSegment(
  p0: Position,
  p1: Position,
  p2: Position,
  p3: Position,
  samples: number,
): Position[] {
  const alpha = 0.5;
  const knot = (ti: number, a: Position, b: Position): number => {
    const d = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
    return ti + Math.max(d, 1e-9) ** alpha;
  };
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);

  const lerp = (a: Position, b: Position, ta: number, tb: number, t: number): Position => {
    const w = (t - ta) / (tb - ta);
    return [a[0]! + (b[0]! - a[0]!) * w, a[1]! + (b[1]! - a[1]!) * w];
  };

  const out: Position[] = [];
  for (let i = 1; i <= samples; i++) {
    const t = t1 + ((t2 - t1) * i) / samples;
    const a1 = lerp(p0, p1, t0, t1, t);
    const a2 = lerp(p1, p2, t1, t2, t);
    const a3 = lerp(p2, p3, t2, t3, t);
    const b1 = lerp(a1, a2, t0, t2, t);
    const b2 = lerp(a2, a3, t1, t3, t);
    out.push(lerp(b1, b2, t1, t2, t));
  }
  return out;
}

/**
 * 站点序列 → 逐区段曲线折线。result[k] = 区段 k(站 k→k+1)的向心 Catmull-Rom
 * 曲线折线(含两端点)。渲染、点击判定、列车运行三者共用,确保几何一致。
 */
export function segmentCurves(pos: Position[]): Position[][] {
  const out: Position[][] = [];
  for (let k = 0; k + 1 < pos.length; k++) {
    const p0 = pos[k - 1] ?? pos[k]!;
    const p1 = pos[k]!;
    const p2 = pos[k + 1]!;
    const p3 = pos[k + 2] ?? pos[k + 1]!;
    out.push([p1, ...centripetalSegment(p0, p1, p2, p3, CURVE_SAMPLES)]);
  }
  return out;
}

/** 沿曲线折线的实际长度(公里),比直线更接近真实轨道长 */
export function polylineLengthKm(points: Position[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    km += haversineKm(
      { lng: points[i - 1]![0]!, lat: points[i - 1]![1]! },
      { lng: points[i]![0]!, lat: points[i]![1]! },
    );
  }
  return km;
}

/**
 * 线网 → 逐区段曲线要素集合。每个区段一个 Feature:
 *   geometry = 该区段的向心 Catmull-Rom 曲线;
 *   properties = { id: 线路id, color, offset: 像素偏移 }。
 * 曲线 + 偏移共用同一构建;offset 交给 MapLibre line-offset(缩放无关)。
 */
export function buildLineFeatures(network: Network): FeatureCollection {
  const bundles = computeBundles(network);
  const features: Feature[] = [];

  for (const line of network.lines) {
    const pts = line.stationIds
      .map((sid) => network.getStation(sid))
      .filter((s): s is StationData => s !== undefined);
    if (pts.length < 2) continue;
    const curves = segmentCurves(pts.map((s): Position => [s.lng, s.lat]));

    for (let k = 0; k < curves.length; k++) {
      features.push({
        type: "Feature",
        properties: {
          id: line.id,
          color: line.color,
          offset: offsetFor(line.id, line.stationIds[k]!, line.stationIds[k + 1]!, bundles),
        },
        geometry: { type: "LineString", coordinates: curves[k]! },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
