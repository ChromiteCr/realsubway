import {
  ATTRACTION_TRIPS_POOL,
  CATCHMENT_RADIUS_M,
  CATCHMENT_SIGMA_M,
  LANDMARK_RADIUS_M,
  TRIP_RATE,
} from "../config/demand";
import { haversineKm } from "../model/geo";
import type { Network } from "../model/network";
import type { DataGrid } from "./grids";

export interface Landmark {
  name: string;
  lng: number;
  lat: number;
  dailyTrips: number;
}

type Listener = () => void;

function gaussWeight(distM: number): number {
  return Math.exp(-(distM * distM) / (2 * CATCHMENT_SIGMA_M * CATCHMENT_SIGMA_M));
}

/**
 * 静态客流估算(M2 口径):
 *   站客流 = (集水区人口×乘车率 + 吸引权重摊池)按多站分格 + 地标加成,再乘换乘系数。
 * 数据栅格缺失时优雅降级(相应分量为 0)。
 */
export class RidershipModel {
  private riders = new Map<string, number>();
  private listeners = new Set<Listener>();
  private unsubscribeNetwork: () => void;

  constructor(
    private readonly network: Network,
    private readonly popGrid: DataGrid | null,
    private readonly attrGrid: DataGrid | null,
    private readonly landmarks: Landmark[],
  ) {
    this.unsubscribeNetwork = network.subscribe(() => this.recompute());
    this.recompute();
  }

  dispose(): void {
    this.unsubscribeNetwork();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ridersAt(stationId: string): number {
    return this.riders.get(stationId) ?? 0;
  }

  total(): number {
    let sum = 0;
    for (const v of this.riders.values()) sum += v;
    return sum;
  }

  get hasData(): boolean {
    return this.popGrid !== null;
  }

  recompute(): void {
    this.riders.clear();
    const stations = this.network.stations;

    // 第一遍:每站的集水区格子及权重;同时累计每个格子的总权重(用于多站分格)
    const catchments = new Map<string, { key: number; w: number }[]>();
    const cellTotalW = new Map<number, number>();
    if (this.popGrid) {
      const grid = this.popGrid;
      for (const s of stations) {
        const cells = grid.cellsWithin(s.lng, s.lat, CATCHMENT_RADIUS_M).map((c) => ({
          key: c.row * grid.meta.width + c.col,
          w: gaussWeight(c.distM),
        }));
        catchments.set(s.id, cells);
        for (const c of cells) cellTotalW.set(c.key, (cellTotalW.get(c.key) ?? 0) + c.w);
      }
    }

    // 吸引栅格与人口栅格同框(管线保证),权重池摊到格
    const attrTotal = this.attrGrid?.meta.totalWeight ?? 0;
    const attrScale = this.attrGrid ? this.attrGrid.meta.scale ?? 1 : 1;
    const attrPerWeight = attrTotal > 0 ? ATTRACTION_TRIPS_POOL / attrTotal : 0;

    // 第二遍:逐站累加人口端 + 吸引端
    for (const s of stations) {
      let trips = 0;
      const cells = catchments.get(s.id) ?? [];
      for (const { key, w } of cells) {
        const share = w / (cellTotalW.get(key) ?? w);
        const pop = this.popGrid ? this.popGrid.data[key]! : 0;
        trips += pop * TRIP_RATE * share;
        if (this.attrGrid) {
          trips += this.attrGrid.data[key]! * attrScale * attrPerWeight * share;
        }
      }
      this.riders.set(s.id, trips);
    }

    // 地标:按高斯权重分给半径内的站
    for (const lm of this.landmarks) {
      const near = stations
        .map((s) => ({ s, distM: haversineKm(s, lm) * 1000 }))
        .filter((x) => x.distM <= LANDMARK_RADIUS_M);
      const totalW = near.reduce((acc, x) => acc + gaussWeight(x.distM), 0);
      if (totalW <= 0) continue;
      for (const { s, distM } of near) {
        const share = gaussWeight(distM) / totalW;
        this.riders.set(s.id, (this.riders.get(s.id) ?? 0) + lm.dailyTrips * share);
      }
    }

    // 换乘加成(jpwright 同款):×(ln(线路数)+1)
    for (const s of stations) {
      const lineCount = this.network.linesThroughStation(s.id).length;
      if (lineCount >= 2) {
        this.riders.set(s.id, this.riders.get(s.id)! * (Math.log(lineCount) + 1));
      }
    }

    for (const l of this.listeners) l();
  }
}
