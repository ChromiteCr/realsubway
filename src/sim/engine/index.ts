import type { NetworkData } from "../../model/types";
import type { DataGrid } from "../grids";
import { assignOD } from "./assign";
import { computeCoverage } from "./coverage";
import { computeEconomy } from "./economy";
import { addHubOD } from "./hubs";
import { gravityOD } from "./od";
import { computeScore, type ScorePart } from "./scoring";
import { computeStationWeights, type Landmark } from "./weights";

export type { Landmark } from "./weights";
export type { ScoreKey, ScorePart } from "./scoring";

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
  /** 日票款收入(元) */
  fareRevenue: number;
  /** 日运营成本(元) */
  operatingCost: number;
  /** 日建设摊销(元) */
  amortization: number;
  /** 日利润(元)= 票款 − 运营 − 摊销,可负 */
  profitPerDay: number;
  /** 综合数值评分 */
  rating: number;
  /** 字母等级 */
  grade: string;
  /** 评分分项明细(M5a6) */
  scoreParts: ScorePart[];
  /** 集水区覆盖人口(人);无人口栅格时为 0 */
  coveredPopulation: number;
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
  // 交通枢纽外生客流叠加到 W 上(机场/火车站),再走同一套分配(M4Y)
  addHubOD(W, net.stations, weights, landmarks);
  const r = assignOD(net, W);
  const eco = computeEconomy(net, r.fareRevenue);
  const coverage = computeCoverage(net, popGrid);
  const score = computeScore(net, {
    servedTrips: r.servedTrips,
    metroDemandTrips: r.metroDemandTrips,
    unservedTrips: r.unservedTrips,
    loadFactors: r.loadFactors,
    coverageRatio: coverage?.ratio ?? null,
    fareRevenue: eco.fareRevenue,
    totalCost: eco.operatingCost + eco.amortization,
  });
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
    fareRevenue: eco.fareRevenue,
    operatingCost: eco.operatingCost,
    amortization: eco.amortization,
    profitPerDay: eco.profitPerDay,
    rating: score.rating,
    grade: score.grade,
    scoreParts: score.parts,
    coveredPopulation: coverage?.population ?? 0,
    computeMs: performance.now() - t0,
  };
}
