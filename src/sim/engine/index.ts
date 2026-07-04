import type { NetworkData } from "../../model/types";
import type { DataGrid } from "../grids";
import { assignOD } from "./assign";
import { gravityOD } from "./od";
import { computeStationWeights, type Landmark } from "./weights";

export type { Landmark } from "./weights";

/** 可结构化克隆的模拟结果(worker → 主线程) */
export interface SimResult {
  stationIds: string[];
  /** 每站日进出站量,与 stationIds 对齐 */
  stationRiders: Float64Array;
  lineIds: string[];
  /** 每线断面去程负载 loads[seg*2+dirBit],与 lineIds 对齐 */
  segLoads: Float32Array[];
  /** 日送达出行(含回程) */
  servedTrips: number;
  /** 因网络不连通无法完成的日出行(含回程) */
  unreachableTrips: number;
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
  const { stationRiders, segLoads, servedTrips, unreachableTrips } = assignOD(net, W);
  return {
    stationIds: net.stations.map((s) => s.id),
    stationRiders,
    lineIds: net.lines.map((l) => l.id),
    segLoads: segLoads.perLine,
    servedTrips,
    unreachableTrips,
    computeMs: performance.now() - t0,
  };
}
