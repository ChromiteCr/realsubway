/**
 * 经济与评分参数(M5)。金额单位:元。全部为可调游戏参数,已按现网标定。
 */

/** 北京地铁里程计价:按乘车距离(公里)返回单程票价(元) */
export function fareForKm(km: number): number {
  if (km <= 6) return 3;
  if (km <= 12) return 4;
  if (km <= 22) return 5;
  if (km <= 32) return 6;
  return 6 + Math.ceil((km - 32) / 20); // 32km 以上每 20km 加 1 元
}

// —— 运营成本(每日)——
/** 车站运营费(元/站·日):人员、动力、维护 */
export const STATION_OPEX_PER_DAY = 30_000;
// 车公里成本在 CAR_SPECS.opexPerCarKm(元/车公里)

// —— 建设成本(用于按日摊销)——
/**
 * 地下线路造价(元/公里)。北京地下线均值约 10 亿,近年新线(16 号线全地下)
 * 达 12 亿/km——取 12 亿更贴近现代造价;配合按曲线实际轨道长计价(见
 * capacity.lineLengthKm),修正长距离区间偏低。
 * 注:用户提出的参考数据未随消息传来,此处按公开真实数据取值,待补数据再对齐。
 */
export const COST_PER_KM = 1_200_000_000; // 12 亿/km(北京 16 号线档)
/** 地下车站造价(元/座) */
export const COST_PER_STATION = 300_000_000; // 约 3 亿/座
/** 车辆购置价在 CAR_SPECS.pricePerCarWan(万元/辆)*/
/** 摊销年限 */
export const AMORTIZE_YEARS = 30;
/** 车队冗余系数(检修/备用),乘在运用车数上 */
export const FLEET_SPARE_RATIO = 1.15;

// —— 综合评分(M5a6 分项评分)——
// 综合分 = Σ 分项分 × 权重,五个分项各 0–100,**统一以真实北京现网为基准**:
//   分项分 = 100 · x^γ / (x^γ + c),x = 本网指标 ÷ 现网基准
// c 取 100/85 − 1,于是 x = 1(与现网持平)恰好得 SCORE_ANCHOR = 85 分(B)。
// 想拿 A 必须在覆盖与规模上明显超过现网——这是 M5a6 提高难度的核心:
// 旧公式的效率乘子上限 1.8 太肥,3 条核心线就能刷到 B+/A。

/** 分项锚点:指标与现网持平时得 85 分(B) */
export const SCORE_ANCHOR = 85;

/**
 * 现网基准(headless 实测,见 starter.validation.test.ts 打印)。
 * 换城市/换数据后需重新标定这五个数。
 */
export const SCORE_REF = {
  /** 集水区并集覆盖人口 ÷ 全域人口 */
  coverage: 0.436,
  /** 日送达出行量(人次) */
  volume: 3.4e6,
  /** 站均日进出站量(人次/站) */
  intensity: 8630,
  /**
   * 服务质量系数 = 1 − 未送达率 − 拥挤惩罚。
   * 这一项不取现网值(0.985):它天然 ≤1,拿现网当基准就只剩不到 1 分的上升空间。
   * 改取设计目标 0.9(九成需求被顺畅送达 = 85 分),现网因此约 89 分。
   */
  service: 0.9,
  /** 成本回收率 = 票款 ÷ (运营 + 摊销) */
  economy: 0.067,
} as const;

/**
 * 陡峭度 γ:越大,低于基准时掉分越快。
 * 绝对量维度(覆盖/规模)取 1.3,小网络掉得快但不至于劝退
 * (M5a6 初版取 1.5,实测偏严,M5a7 下调);
 * 效率/经济取 0.8(且天然封顶 100),压住"小而密"刷分;
 * 服务质量取 4——它上不封顶意义不大,主要用来罚挤爆和停运。
 */
export const SCORE_GAMMA = {
  coverage: 1.3,
  volume: 1.3,
  intensity: 0.8,
  service: 4,
  economy: 0.8,
} as const;

/** 分项权重(和为 1)。缺数据的分项(如无人口栅格)会被剔除并归一化 */
export const SCORE_WEIGHT = {
  coverage: 0.28,
  volume: 0.3,
  intensity: 0.15,
  service: 0.15,
  economy: 0.12,
} as const;

/** 服务质量下限:再差也不低于此(避免评分归零) */
export const SERVICE_QUALITY_FLOOR = 0.35;
/** 拥挤对服务质量的惩罚权重(乘在平均超载率上) */
export const SCORE_CROWD_WEIGHT = 0.5;
