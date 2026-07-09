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

// —— 综合评分 ——
// 评分 = σ × ln(运输总量/百万 + 1) × 效率乘子 × 服务质量
// 主项是绝对客流(覆盖度)的对数;效率只作**有界乘子**,防止一条超密小线
// 靠"每站客流极高"刷高分——绝对规模不足的系统应得低分。
/** 典型每站每日进出站量(≈现网水平),效率乘子以此为 1.0 基准 */
export const SCORE_EFF_NORMAL = 4000;
/** 效率乘子的上下限:再高效也不超过 CAP,再低效也不低于 FLOOR */
export const SCORE_EFF_FLOOR = 0.4;
export const SCORE_EFF_CAP = 1.8;
/**
 * 总体缩放系数 σ,标定使真实北京现网 ≈ B(约 85)。
 * 现网:ln(3.4M/1M+1)=1.48,效率乘子≈0.95,服务质量≈0.99 → σ ≈ 61
 * (见 starter.validation.test.ts 的 "M5:综合评分标定")。
 */
export const SCORE_SIGMA = 61;
/** 服务质量下限:再差也不低于此(避免评分归零) */
export const SERVICE_QUALITY_FLOOR = 0.35;
/** 拥挤对服务质量的惩罚权重(乘在平均超载率上) */
export const SCORE_CROWD_WEIGHT = 0.5;
