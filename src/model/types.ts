/** 车型:A/B/C 对应国标 3.0m / 2.8m / 2.6m 车宽 */
export type CarType = "A" | "B" | "C";

export interface RollingStock {
  type: CarType;
  /** 编组辆数,如 8A 的 8 */
  cars: number;
}

/** 一条线路的服务计划:首末班车 + 逐小时班次密度 + 车型编组 */
export interface ServicePlan {
  /** 首班车,从 00:00 起的分钟数(330 = 05:30) */
  firstTrainMin: number;
  /** 末班车,从 00:00 起的分钟数(1380 = 23:00) */
  lastTrainMin: number;
  /** 按自然小时(0-23)索引的发车间隔,单位分钟;运营时段外的项忽略 */
  headwayByHour: number[];
  stock: RollingStock;
}

export interface StationData {
  id: string;
  name: string;
  lng: number;
  lat: number;
}

export interface LineData {
  id: string;
  name: string;
  color: string;
  /** 站序,允许同一站出现多次(环线首尾相接时首尾同站) */
  stationIds: string[];
  servicePlan: ServicePlan;
}

/** 存档格式:只存网络定义,模拟结果都是推导量 */
export interface NetworkData {
  version: 1;
  stations: StationData[];
  lines: LineData[];
}
