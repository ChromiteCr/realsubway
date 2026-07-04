import {
  ACCESS_MIN,
  DWELL_MIN,
  TRAIN_SPEED_KMH,
  TRANSFER_WALK_MIN,
} from "../../config/simulation";
import { haversineKm } from "../../model/geo";
import type { LineData, NetworkData } from "../../model/types";

/**
 * (线路,站位)扩展图:
 * - 每条线的第 k 个停站是一个"车上"节点,相邻站位间是乘车边
 * - 每个车站另有一个"街面"节点;上车边付候车(间隔/2),下车边付出站
 * - 换乘 = 下车 → 街面(含换乘步行) → 再上车(再付候车),无需显式换乘边
 */
export interface SimGraph {
  /** 节点总数 = 街面节点(=站数) + 各线站位数之和 */
  nodeCount: number;
  /** CSR 邻接表 */
  adjStart: Int32Array;
  adjTarget: Int32Array;
  adjWeight: Float64Array;
  /** 乘车边的归属:edge -> lineIdx,非乘车边为 -1 */
  edgeLine: Int32Array;
  /** 乘车边的区间号(线内 k -> k+1 为区间 k)与方向(+1 顺 / -1 逆) */
  edgeSeg: Int32Array;
  edgeDir: Int8Array;
  /** 街面节点 = 站的下标(0..n-1) */
  stationCount: number;
}

/** 线路的平均候车时间(分钟):运营时段发车间隔均值 / 2 */
export function avgWaitMin(line: LineData): number {
  const { firstTrainMin, lastTrainMin, headwayByHour } = line.servicePlan;
  const h0 = Math.floor(firstTrainMin / 60);
  const h1 = Math.min(23, Math.floor(lastTrainMin / 60));
  let sum = 0;
  let cnt = 0;
  for (let h = h0; h <= h1; h++) {
    sum += headwayByHour[h] ?? 6;
    cnt++;
  }
  return cnt > 0 ? sum / cnt / 2 : 3;
}

export function buildGraph(net: NetworkData): SimGraph {
  const stationIdx = new Map<string, number>();
  net.stations.forEach((s, i) => stationIdx.set(s.id, i));
  const n = net.stations.length;

  // 节点编号:0..n-1 街面;之后按线依次分配站位节点
  let nodeCount = n;
  const lineNodeStart: number[] = [];
  for (const line of net.lines) {
    lineNodeStart.push(nodeCount);
    nodeCount += line.stationIds.length;
  }

  interface Edge {
    from: number;
    to: number;
    w: number;
    line: number;
    seg: number;
    dir: number;
  }
  const edges: Edge[] = [];
  const stationById = new Map(net.stations.map((s) => [s.id, s]));

  net.lines.forEach((line, li) => {
    const wait = avgWaitMin(line);
    const base = lineNodeStart[li]!;
    line.stationIds.forEach((sid, k) => {
      const si = stationIdx.get(sid);
      if (si === undefined) return;
      const onboard = base + k;
      // 上车:街面 -> 车上(候车 + 进站)
      edges.push({ from: si, to: onboard, w: wait + ACCESS_MIN, line: -1, seg: -1, dir: 0 });
      // 下车:车上 -> 街面(出站/换乘步行的一半;换乘合计≈TRANSFER_WALK)
      edges.push({ from: onboard, to: si, w: TRANSFER_WALK_MIN / 2, line: -1, seg: -1, dir: 0 });
      // 乘车边
      if (k + 1 < line.stationIds.length) {
        const a = stationById.get(sid);
        const b = stationById.get(line.stationIds[k + 1]!);
        if (a && b) {
          const t = (haversineKm(a, b) / TRAIN_SPEED_KMH) * 60 + DWELL_MIN;
          edges.push({ from: onboard, to: onboard + 1, w: t, line: li, seg: k, dir: 1 });
          edges.push({ from: onboard + 1, to: onboard, w: t, line: li, seg: k, dir: -1 });
        }
      }
    });
  });

  // 组装 CSR
  const degree = new Int32Array(nodeCount);
  for (const e of edges) degree[e.from]!++;
  const adjStart = new Int32Array(nodeCount + 1);
  for (let i = 0; i < nodeCount; i++) adjStart[i + 1] = adjStart[i]! + degree[i]!;
  const adjTarget = new Int32Array(edges.length);
  const adjWeight = new Float64Array(edges.length);
  const edgeLine = new Int32Array(edges.length);
  const edgeSeg = new Int32Array(edges.length);
  const edgeDir = new Int8Array(edges.length);
  const cursor = adjStart.slice(0, nodeCount);
  for (const e of edges) {
    const at = cursor[e.from]!++;
    adjTarget[at] = e.to;
    adjWeight[at] = e.w;
    edgeLine[at] = e.line;
    edgeSeg[at] = e.seg;
    edgeDir[at] = e.dir;
  }

  return { nodeCount, adjStart, adjTarget, adjWeight, edgeLine, edgeSeg, edgeDir, stationCount: n };
}

export interface ShortestPaths {
  dist: Float64Array;
  /** 前驱边下标(CSR 边号),-1 表示无 */
  predEdge: Int32Array;
  predNode: Int32Array;
}

/** 二叉堆 Dijkstra,typed array 实现,单源全图 */
export function dijkstra(g: SimGraph, source: number): ShortestPaths {
  const dist = new Float64Array(g.nodeCount).fill(Infinity);
  const predEdge = new Int32Array(g.nodeCount).fill(-1);
  const predNode = new Int32Array(g.nodeCount).fill(-1);
  const heapNode = new Int32Array(g.nodeCount * 4);
  const heapKey = new Float64Array(g.nodeCount * 4);
  let heapSize = 0;

  const push = (node: number, key: number) => {
    let i = heapSize++;
    heapNode[i] = node;
    heapKey[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p]! <= heapKey[i]!) break;
      [heapKey[p], heapKey[i]] = [heapKey[i]!, heapKey[p]!];
      [heapNode[p], heapNode[i]] = [heapNode[i]!, heapNode[p]!];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heapNode[0]!;
    heapSize--;
    heapNode[0] = heapNode[heapSize]!;
    heapKey[0] = heapKey[heapSize]!;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < heapSize && heapKey[l]! < heapKey[m]!) m = l;
      if (r < heapSize && heapKey[r]! < heapKey[m]!) m = r;
      if (m === i) break;
      [heapKey[m], heapKey[i]] = [heapKey[i]!, heapKey[m]!];
      [heapNode[m], heapNode[i]] = [heapNode[i]!, heapNode[m]!];
      i = m;
    }
    return top;
  };

  dist[source] = 0;
  push(source, 0);
  const settled = new Uint8Array(g.nodeCount);
  while (heapSize > 0) {
    const u = pop();
    if (settled[u]) continue;
    settled[u] = 1;
    const du = dist[u]!;
    for (let e = g.adjStart[u]!; e < g.adjStart[u + 1]!; e++) {
      const v = g.adjTarget[e]!;
      const nd = du + g.adjWeight[e]!;
      if (nd < dist[v]!) {
        dist[v] = nd;
        predEdge[v] = e;
        predNode[v] = u;
        push(v, nd);
      }
    }
  }
  return { dist, predEdge, predNode };
}
