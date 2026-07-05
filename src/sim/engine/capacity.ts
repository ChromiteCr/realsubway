import { trainCapacity } from "../../config/rollingstock";
import { AM_PROFILE, PM_PROFILE } from "../../config/simulation";
import { haversineKm } from "../../model/geo";
import type { LineData, NetworkData } from "../../model/types";

/** 自然小时 h 内的运营分钟数(首末班车切掉部分小时) */
export function serviceMinutesInHour(line: LineData, h: number): number {
  const { firstTrainMin, lastTrainMin } = line.servicePlan;
  const start = Math.max(firstTrainMin, h * 60);
  const end = Math.min(lastTrainMin, (h + 1) * 60);
  return Math.max(0, end - start);
}

/** 每小时单向运力(人次/h)= 发车数 × 一列车定员 */
export function hourlyCapacity(line: LineData): Float64Array {
  const cap = new Float64Array(24);
  const perTrain = trainCapacity(line.servicePlan.stock);
  for (let h = 0; h < 24; h++) {
    const minutes = serviceMinutesInHour(line, h);
    if (minutes <= 0) continue;
    const headway = line.servicePlan.headwayByHour[h] ?? 6;
    cap[h] = (minutes / headway) * perTrain;
  }
  return cap;
}

/**
 * 每条线的截断系数表 frac[seg*48 + dir*24 + h] = min(1, 运力/需求)。
 * 需求由去程断面 segW 与早晚高峰曲线合成;运营时段外运力为 0 → frac 0。
 */
export function lineFracTable(line: LineData, segW: Float32Array): Float32Array {
  const segs = Math.max(0, line.stationIds.length - 1);
  const frac = new Float32Array(segs * 48).fill(1);
  const cap = hourlyCapacity(line);
  for (let seg = 0; seg < segs; seg++) {
    const fw = segW[seg * 2] ?? 0;
    const bw = segW[seg * 2 + 1] ?? 0;
    for (let dir = 0; dir < 2; dir++) {
      const out = dir === 0 ? fw : bw;
      const back = dir === 0 ? bw : fw;
      for (let h = 0; h < 24; h++) {
        const load = out * AM_PROFILE[h]! + back * PM_PROFILE[h]!;
        if (load <= 0) continue;
        frac[seg * 48 + dir * 24 + h] = Math.min(1, cap[h]! / load);
      }
    }
  }
  return frac;
}

/** 每条线区间的最高满载率(最忙小时/方向的 需求÷运力;运力为0且有需求时记 Infinity→封顶99) */
export function lineLoadFactor(line: LineData, segW: Float32Array): Float32Array {
  const segs = Math.max(0, line.stationIds.length - 1);
  const lf = new Float32Array(segs);
  const cap = hourlyCapacity(line);
  for (let seg = 0; seg < segs; seg++) {
    const fw = segW[seg * 2] ?? 0;
    const bw = segW[seg * 2 + 1] ?? 0;
    let worst = 0;
    for (let h = 0; h < 24; h++) {
      for (const [out, back] of [
        [fw, bw],
        [bw, fw],
      ] as const) {
        const load = out * AM_PROFILE[h]! + back * PM_PROFILE[h]!;
        if (load <= 0) continue;
        const ratio = cap[h]! > 0 ? load / cap[h]! : 99;
        if (ratio > worst) worst = ratio;
      }
    }
    lf[seg] = Math.min(99, worst);
  }
  return lf;
}

/** 全日列车公里(双向):Σ_h 运营分钟/间隔 × 线路长度 × 2 */
export function lineTrainKm(net: NetworkData, line: LineData): number {
  let lenKm = 0;
  const byId = new Map(net.stations.map((s) => [s.id, s]));
  for (let k = 0; k + 1 < line.stationIds.length; k++) {
    const a = byId.get(line.stationIds[k]!);
    const b = byId.get(line.stationIds[k + 1]!);
    if (a && b) lenKm += haversineKm(a, b);
  }
  let departures = 0;
  for (let h = 0; h < 24; h++) {
    const minutes = serviceMinutesInHour(line, h);
    if (minutes <= 0) continue;
    departures += minutes / (line.servicePlan.headwayByHour[h] ?? 6);
  }
  return lenKm * departures * 2;
}
