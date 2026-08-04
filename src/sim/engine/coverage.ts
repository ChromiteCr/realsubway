import { CATCHMENT_RADIUS_M } from "../../config/demand";
import type { NetworkData } from "../../model/types";
import type { DataGrid } from "../grids";

export interface Coverage {
  /** 被集水区覆盖的常住人口 */
  population: number;
  /** 覆盖人口 ÷ 全域人口 ∈ [0,1] */
  ratio: number;
}

/**
 * 人口覆盖(M5a6 评分分项):接入线路的车站集水区(CATCHMENT_RADIUS_M)**并集**
 * 覆盖的人口。用并集而非各站相加——重叠格子只算一次,密集建站不虚增覆盖。
 * 无人口栅格(或栅格没带总人口)时返回 null,评分会剔除该分项并归一化权重。
 */
export function computeCoverage(net: NetworkData, popGrid: DataGrid | null): Coverage | null {
  const total = popGrid?.meta.totalPopulation;
  if (!popGrid || !total) return null;

  const active = new Set<string>();
  for (const line of net.lines) for (const sid of line.stationIds) active.add(sid);

  const seen = new Set<number>();
  let population = 0;
  for (const s of net.stations) {
    if (!active.has(s.id)) continue; // 孤立站不投运,不算覆盖
    for (const c of popGrid.cellsWithin(s.lng, s.lat, CATCHMENT_RADIUS_M)) {
      const key = c.row * popGrid.meta.width + c.col;
      if (seen.has(key)) continue;
      seen.add(key);
      population += popGrid.valueAt(c.row, c.col);
    }
  }
  return { population, ratio: population / total };
}
