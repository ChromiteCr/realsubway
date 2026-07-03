import type { CarType, RollingStock, ServicePlan } from "../model/types";

export interface CarSpec {
  widthM: number;
  /** 定员(人/辆) */
  capacity: number;
  /** 超员(人/辆),拥挤上限 */
  crushCapacity: number;
  /** 购置价(万元/辆),M4 经济模型用 */
  pricePerCarWan: number;
  /** 运营成本(元/车公里),M4 经济模型用 */
  opexPerCarKm: number;
}

export const CAR_SPECS: Record<CarType, CarSpec> = {
  A: { widthM: 3.0, capacity: 310, crushCapacity: 410, pricePerCarWan: 1000, opexPerCarKm: 42 },
  B: { widthM: 2.8, capacity: 245, crushCapacity: 325, pricePerCarWan: 700, opexPerCarKm: 36 },
  C: { widthM: 2.6, capacity: 210, crushCapacity: 280, pricePerCarWan: 550, opexPerCarKm: 30 },
};

export const DEFAULT_STOCK: RollingStock = { type: "B", cars: 6 };

/** 默认服务计划:05:30-23:00,高峰 3 分钟、平峰 6 分钟 */
export function defaultServicePlan(): ServicePlan {
  const headwayByHour = new Array<number>(24).fill(6);
  for (const h of [7, 8, 17, 18]) headwayByHour[h] = 3;
  return {
    firstTrainMin: 330,
    lastTrainMin: 1380,
    headwayByHour,
    stock: { ...DEFAULT_STOCK },
  };
}

/** 一列车定员 = 单辆定员 × 编组 */
export function trainCapacity(stock: RollingStock): number {
  return CAR_SPECS[stock.type].capacity * stock.cars;
}
