import { AM_PROFILE, PM_PROFILE } from "../../config/simulation";
import type { NetworkData } from "../../model/types";
import { lineFracTable, lineLoadFactor } from "./capacity";
import { buildGraph, dijkstra, type SimGraph } from "./graph";

export interface AssignResult {
  /** 每站日进出站量(按实际送达计,去程+回程) */
  stationRiders: Float64Array;
  /** 每线断面"需求"负载 loads[seg*2+dirBit](未截断,供满载率与弹窗) */
  segLoads: Float32Array[];
  /** 每线区间最高满载率(需求÷运力,>1 即拥挤截断) */
  loadFactors: Float32Array[];
  /** 日送达出行(容量与运营时段截断后,含回程) */
  servedTrips: number;
  /** 因超运力或停运未送达的日出行(含回程) */
  unservedTrips: number;
  /** 因网络不连通根本无法乘坐的日出行(含回程) */
  unreachableTrips: number;
}

/**
 * 两阶段分配(以计算换内存:不缓存 OD 路径,Dijkstra 跑两遍):
 * 阶段一:全有全无分配得到断面"需求"负载;
 * 阶段二:由需求 vs 逐小时运力得到每段截断系数(capacity.lineFracTable),
 *         重走每条路径,按瓶颈(路径上系数最小的段)截断,累计实际送达。
 */
export function assignOD(net: NetworkData, W: Float32Array): AssignResult {
  const g: SimGraph = buildGraph(net);
  const n = g.stationCount;
  const segLoads = net.lines.map(
    (l) => new Float32Array(Math.max(0, l.stationIds.length - 1) * 2),
  );
  const stationRiders = new Float64Array(n);
  let unreachable = 0;

  const rowHasTrips = (i: number): boolean => {
    for (let j = 0; j < n; j++) if (W[i * n + j]! > 0) return true;
    return false;
  };

  // —— 阶段一:需求断面 ——
  for (let i = 0; i < n; i++) {
    if (!rowHasTrips(i)) continue;
    const { dist, predEdge, predNode } = dijkstra(g, i);
    for (let j = 0; j < n; j++) {
      const trips = W[i * n + j]!;
      if (trips <= 0) continue;
      if (!Number.isFinite(dist[j]!)) {
        unreachable += trips * 2;
        continue;
      }
      let v = j;
      while (v !== i) {
        const e = predEdge[v]!;
        if (e < 0) break;
        const li = g.edgeLine[e]!;
        if (li >= 0) {
          const dirBit = g.edgeDir[e]! === 1 ? 0 : 1;
          segLoads[li]![g.edgeSeg[e]! * 2 + dirBit]! += trips;
        }
        v = predNode[v]!;
      }
    }
  }

  // —— 截断系数与满载率 ——
  const fracs = net.lines.map((l, li) => lineFracTable(l, segLoads[li]!));
  const loadFactors = net.lines.map((l, li) => lineLoadFactor(l, segLoads[li]!));

  // —— 阶段二:按瓶颈截断,统计送达 ——
  let served = 0;
  let unserved = 0;
  const minOut = new Float64Array(24);
  const minRet = new Float64Array(24);

  for (let i = 0; i < n; i++) {
    if (!rowHasTrips(i)) continue;
    const { dist, predEdge, predNode } = dijkstra(g, i);
    for (let j = 0; j < n; j++) {
      const trips = W[i * n + j]!;
      if (trips <= 0 || !Number.isFinite(dist[j]!)) continue;

      minOut.fill(1);
      minRet.fill(1);
      let v = j;
      while (v !== i) {
        const e = predEdge[v]!;
        if (e < 0) break;
        const li = g.edgeLine[e]!;
        if (li >= 0) {
          const seg = g.edgeSeg[e]!;
          const dirBit = g.edgeDir[e]! === 1 ? 0 : 1;
          const frac = fracs[li]!;
          const outBase = seg * 48 + dirBit * 24;
          const retBase = seg * 48 + (1 - dirBit) * 24;
          for (let h = 0; h < 24; h++) {
            const fo = frac[outBase + h]!;
            if (fo < minOut[h]!) minOut[h] = fo;
            const fr = frac[retBase + h]!;
            if (fr < minRet[h]!) minRet[h] = fr;
          }
        }
        v = predNode[v]!;
      }

      let servedFrac = 0;
      for (let h = 0; h < 24; h++) {
        servedFrac += AM_PROFILE[h]! * minOut[h]! + PM_PROFILE[h]! * minRet[h]!;
      }
      const servedTrips = trips * servedFrac;
      served += servedTrips;
      unserved += trips * (2 - servedFrac);
      stationRiders[i]! += servedTrips;
      stationRiders[j]! += servedTrips;
    }
  }

  return {
    stationRiders,
    segLoads,
    loadFactors,
    servedTrips: served,
    unservedTrips: unserved,
    unreachableTrips: unreachable,
  };
}
