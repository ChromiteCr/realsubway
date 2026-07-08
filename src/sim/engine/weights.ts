import {
  ATTRACTION_TRIPS_POOL,
  CATCHMENT_RADIUS_M,
  CATCHMENT_SIGMA_M,
  LANDMARK_RADIUS_M,
  POTENTIAL_RATE,
} from "../../config/demand";
import { haversineKm } from "../../model/geo";
import type { StationData } from "../../model/types";
import type { DataGrid } from "../grids";

export interface Landmark {
  name: string;
  lng: number;
  lat: number;
  dailyTrips: number;
  /** true = 交通枢纽(机场/火车站),走 M4Y 外生 OD 层,不计入引力吸引 */
  hub?: boolean;
}

export interface StationWeights {
  /** 出行产生量(人次/日):集水区人口 × 乘车率 + 地标份额 */
  production: Float64Array;
  /** 出行吸引权重(人次/日):就业池份额 + 地标份额 */
  attraction: Float64Array;
}

function gaussWeight(distM: number): number {
  return Math.exp(-(distM * distM) / (2 * CATCHMENT_SIGMA_M * CATCHMENT_SIGMA_M));
}

/**
 * 站点生产/吸引权重(M2 的核采样,输出改为 OD 两端):
 * 同一格被多站覆盖时按高斯权重分摊,避免密集建站凭空放大需求。
 */
export function computeStationWeights(
  stations: StationData[],
  popGrid: DataGrid | null,
  attrGrid: DataGrid | null,
  landmarks: Landmark[],
): StationWeights {
  const n = stations.length;
  const production = new Float64Array(n);
  const attraction = new Float64Array(n);

  if (popGrid) {
    const catchments: { key: number; w: number }[][] = [];
    const cellTotalW = new Map<number, number>();
    for (const s of stations) {
      const cells = popGrid.cellsWithin(s.lng, s.lat, CATCHMENT_RADIUS_M).map((c) => ({
        key: c.row * popGrid.meta.width + c.col,
        w: gaussWeight(c.distM),
      }));
      catchments.push(cells);
      for (const c of cells) cellTotalW.set(c.key, (cellTotalW.get(c.key) ?? 0) + c.w);
    }

    const attrTotal = attrGrid?.meta.totalWeight ?? 0;
    const attrScale = attrGrid ? (attrGrid.meta.scale ?? 1) : 1;
    const attrPerWeight = attrTotal > 0 ? ATTRACTION_TRIPS_POOL / attrTotal : 0;

    for (let i = 0; i < n; i++) {
      for (const { key, w } of catchments[i]!) {
        const share = w / (cellTotalW.get(key) ?? w);
        production[i]! += popGrid.data[key]! * POTENTIAL_RATE * share;
        if (attrGrid) {
          attraction[i]! += attrGrid.data[key]! * attrScale * attrPerWeight * share;
        }
      }
    }
  }

  // 吸引型地标同时计入两端:既产生出行也吸引出行。
  // 交通枢纽(hub)不在此处理——它们是外生客流,由 addHubOD 单独注入(M4Y)。
  for (const lm of landmarks) {
    if (lm.hub) continue;
    const near: { idx: number; w: number }[] = [];
    for (let i = 0; i < n; i++) {
      const distM = haversineKm(stations[i]!, lm) * 1000;
      if (distM <= LANDMARK_RADIUS_M) near.push({ idx: i, w: gaussWeight(distM) });
    }
    const totalW = near.reduce((acc, x) => acc + x.w, 0);
    if (totalW <= 0) continue;
    for (const { idx, w } of near) {
      const share = (w / totalW) * lm.dailyTrips;
      production[idx]! += share * 0.5;
      attraction[idx]! += share * 0.5;
    }
  }

  // 吸引数据完全缺失时用生产端代理(人去人多的地方),保证引力模型有目的地
  let attrSum = 0;
  for (let i = 0; i < n; i++) attrSum += attraction[i]!;
  if (attrSum === 0) attraction.set(production);

  return { production, attraction };
}
