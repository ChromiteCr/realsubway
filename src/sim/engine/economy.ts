import {
  AMORTIZE_YEARS,
  COST_PER_KM,
  COST_PER_STATION,
  FLEET_SPARE_RATIO,
  STATION_OPEX_PER_DAY,
} from "../../config/economy";
import { CAR_SPECS } from "../../config/rollingstock";
import { TRAIN_SPEED_KMH } from "../../config/simulation";
import type { LineData, NetworkData } from "../../model/types";
import { lineLengthKm, lineTrainKm } from "./capacity";

export interface Economy {
  /** 日票款收入(元) */
  fareRevenue: number;
  /** 日运营成本(元):车公里 + 车站运营 */
  operatingCost: number;
  /** 日建设摊销(元):线路+车站+车辆购置 ÷ 年限 ÷ 365 */
  amortization: number;
  /** 日利润(元)= 票款 − 运营 − 摊销,可负 */
  profitPerDay: number;
}

/** 一条线运用车数(峰值):往返走行时 / 最小发车间隔,乘冗余系数 */
function fleetCarsForLine(net: NetworkData, line: LineData): number {
  const lenKm = lineLengthKm(net, line);
  if (lenKm <= 0) return 0;
  const oneWayMin = (lenKm / TRAIN_SPEED_KMH) * 60;
  const { firstTrainMin, lastTrainMin, headwayByHour } = line.servicePlan;
  const h0 = Math.floor(firstTrainMin / 60);
  const h1 = Math.min(23, Math.floor(lastTrainMin / 60));
  let minHeadway = Infinity;
  for (let h = h0; h <= h1; h++) minHeadway = Math.min(minHeadway, headwayByHour[h] ?? 6);
  if (!Number.isFinite(minHeadway) || minHeadway <= 0) return 0;
  const trains = Math.ceil(((2 * oneWayMin) / minHeadway) * FLEET_SPARE_RATIO);
  return trains * line.servicePlan.stock.cars;
}

/**
 * 经济核算(M5)。fareRevenue 由 assignOD 给出(依赖客流),其余由线网结构导出。
 * 全部为聚合量,无按站/按 OD 的大数组,内存开销可忽略。
 */
export function computeEconomy(net: NetworkData, fareRevenue: number): Economy {
  // 运营成本
  let opex = 0;
  for (const line of net.lines) {
    const carKm = lineTrainKm(net, line) * line.servicePlan.stock.cars;
    opex += carKm * CAR_SPECS[line.servicePlan.stock.type].opexPerCarKm;
  }
  // 只有接入线路的车站才算运营(孤立站不投运)
  const activeStations = new Set<string>();
  for (const line of net.lines) for (const sid of line.stationIds) activeStations.add(sid);
  opex += activeStations.size * STATION_OPEX_PER_DAY;

  // 建设摊销
  let capital = activeStations.size * COST_PER_STATION;
  for (const line of net.lines) {
    capital += lineLengthKm(net, line) * COST_PER_KM;
    capital += fleetCarsForLine(net, line) * CAR_SPECS[line.servicePlan.stock.type].pricePerCarWan * 10_000;
  }
  const amortization = capital / (AMORTIZE_YEARS * 365);

  return {
    fareRevenue,
    operatingCost: opex,
    amortization,
    profitPerDay: fareRevenue - opex - amortization,
  };
}
