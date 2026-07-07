import type { NetworkData } from "../../model/types";
import type { DataGrid } from "../grids";
import { assignOD } from "./assign";
import { gravityOD } from "./od";
import { computeStationWeights, type Landmark } from "./weights";

export type { Landmark } from "./weights";

/** 可结构化克隆的模拟结果(worker → 主线程) */
export interface SimResult {
  stationIds: string[];
  /** 每站日进出站量(按实际送达计),与 stationIds 对齐 */
  stationRiders: Float64Array;
  lineIds: string[];
  /** 每线断面需求负载 loads[seg*2+dirBit](未截断),与 lineIds 对齐 */
  segLoads: Float32Array[];
  /** 每线区间最高满载率(需求÷运力),与 lineIds 对齐 */
  loadFactors: Float32Array[];
  /** 潜在通勤出行(含回程),分担率分母 */
  potentialTrips: number;
  /** 选择地铁的出行(截断前,含回程) */
  metroDemandTrips: number;
  /** 运输总量:容量与运营时段截断后的日送达出行(含回程) */
  servedTrips: number;
  /** 选择地铁但因超运力/停运未送达(含回程) */
  unservedTrips: number;
  computeMs: number;
}

export function runSimulation(
  net: NetworkData,
  popGrid: DataGrid | null,
  attrGrid: DataGrid | null,
  landmarks: Landmark[],
): SimResult {
  const t0 = performance.now();
  const weights = computeStationWeights(net.stations, popGrid, attrGrid, landmarks);
  const W = gravityOD(net.stations, weights);
  const r = assignOD(net, W);
  return {
    stationIds: net.stations.map((s) => s.id),
    stationRiders: r.stationRiders,
    lineIds: net.lines.map((l) => l.id),
    segLoads: r.segLoads,
    loadFactors: r.loadFactors,
    potentialTrips: r.potentialTrips,
    metroDemandTrips: r.metroDemandTrips,
    servedTrips: r.servedTrips,
    unservedTrips: r.unservedTrips,
    computeMs: performance.now() - t0,
  };
}
