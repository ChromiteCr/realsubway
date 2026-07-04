import type { NetworkData } from "../../model/types";
import { buildGraph, dijkstra, type SimGraph } from "./graph";

export interface SegmentLoads {
  /** 每条线:loads[seg*2 + dirBit],dirBit 0=顺(k→k+1) 1=逆;单位:去程人次/日 */
  perLine: Float32Array[];
}

export interface AssignResult {
  /** 每站日进出站量(去程+回程都计) */
  stationRiders: Float64Array;
  /** 去程(W 方向)断面;回程 = 对向断面的镜像 */
  segLoads: SegmentLoads;
  /** 实际被分配(两端连通)的日出行量,含回程 */
  servedTrips: number;
  /** 因不连通未送达的日出行量,含回程 */
  unreachableTrips: number;
}

/**
 * 全有全无分配:每个 OD 对走时间最短路,把去程 W_ij 累加到沿途乘车边。
 * 回程(Wᵀ)不重复分配——图是对称的,回程断面即对向断面。
 * 站点进出站量 = Σ_j (W_ij + W_ji) × 2(去程进+出,回程再来一遍)…
 * 简化口径:riders_i = 2 × (rowSum_i + colSum_i),表示全日进+出站总人次。
 */
export function assignOD(net: NetworkData, W: Float32Array): AssignResult {
  const g: SimGraph = buildGraph(net);
  const n = g.stationCount;
  const perLine = net.lines.map(
    (l) => new Float32Array(Math.max(0, l.stationIds.length - 1) * 2),
  );
  const stationRiders = new Float64Array(n);
  let served = 0;
  let unreachable = 0;

  for (let i = 0; i < n; i++) {
    // 该行有出行才值得跑最短路
    let rowHasTrips = false;
    for (let j = 0; j < n; j++) {
      if (W[i * n + j]! > 0) {
        rowHasTrips = true;
        break;
      }
    }
    if (!rowHasTrips) continue;

    const { dist, predEdge, predNode } = dijkstra(g, i);
    for (let j = 0; j < n; j++) {
      const trips = W[i * n + j]!;
      if (trips <= 0) continue;
      if (!Number.isFinite(dist[j]!)) {
        unreachable += trips * 2;
        continue;
      }
      served += trips * 2;
      stationRiders[i]! += trips * 2;
      stationRiders[j]! += trips * 2;
      // 回溯路径,累加乘车边
      let v = j;
      while (v !== i) {
        const e = predEdge[v]!;
        if (e < 0) break;
        const li = g.edgeLine[e]!;
        if (li >= 0) {
          const seg = g.edgeSeg[e]!;
          const dirBit = g.edgeDir[e]! === 1 ? 0 : 1;
          perLine[li]![seg * 2 + dirBit]! += trips;
        }
        v = predNode[v]!;
      }
    }
  }

  return { stationRiders, segLoads: { perLine }, servedTrips: served, unreachableTrips: unreachable };
}
