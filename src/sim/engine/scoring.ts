import {
  SCORE_ANCHOR,
  SCORE_CROWD_WEIGHT,
  SCORE_GAMMA,
  SCORE_REF,
  SCORE_WEIGHT,
  SERVICE_QUALITY_FLOOR,
} from "../../config/economy";
import type { NetworkData } from "../../model/types";

export type ScoreKey = "coverage" | "volume" | "intensity" | "service" | "economy";

export interface ScoreInput {
  servedTrips: number;
  metroDemandTrips: number;
  unservedTrips: number;
  loadFactors: Float32Array[];
  /** 集水区覆盖人口比;null = 无人口栅格,剔除该分项 */
  coverageRatio: number | null;
  /** 日票款(元) */
  fareRevenue: number;
  /** 日总成本(元)= 运营 + 摊销;≤0 时剔除经济分项 */
  totalCost: number;
}

/** 一个评分分项(纯数值,标签与格式化在 UI 侧) */
export interface ScorePart {
  key: ScoreKey;
  /** 本项得分 0–100 */
  score: number;
  /** 归一化后的实际权重(缺项被剔除后重新分配) */
  weight: number;
  /** 本网指标原值 */
  value: number;
  /** 现网基准值 */
  ref: number;
}

export interface Score {
  /** 0–100 的综合评分 */
  rating: number;
  /** 字母等级 */
  grade: string;
  /** 服务质量系数 ∈ [floor,1](供 UI 解释) */
  serviceQuality: number;
  /** 分项明细,按权重降序 */
  parts: ScorePart[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** jpwright 风格:数值分 → 字母等级 */
export function letterGrade(rating: number): string {
  if (rating >= 97) return "A+";
  if (rating >= 93) return "A";
  if (rating >= 90) return "A-";
  if (rating >= 87) return "B+";
  if (rating >= 83) return "B";
  if (rating >= 80) return "B-";
  if (rating >= 77) return "C+";
  if (rating >= 73) return "C";
  if (rating >= 70) return "C-";
  if (rating >= 67) return "D+";
  if (rating >= 63) return "D";
  if (rating >= 60) return "D-";
  return "F";
}

/** x=1(与现网持平)→ SCORE_ANCHOR 分的饱和曲线,上限 100 */
const CURVE_C = 100 / SCORE_ANCHOR - 1;

export function partScore(value: number, ref: number, gamma: number): number {
  if (!(value > 0) || !(ref > 0)) return 0;
  const x = (value / ref) ** gamma;
  return (100 * x) / (x + CURVE_C);
}

/**
 * 综合评分(M5:字母等级;M5a6:改为五分项加权)。
 * 每个分项都拿真实北京现网当标尺(现网 = 85 = B),综合分是加权和,
 * 所以"三条线覆盖热力图红区"这类小而密的网络会输在覆盖与规模上,
 * 想拿 A 必须真的比现网铺得更广、运得更多。纯聚合,内存可忽略。
 */
export function computeScore(net: NetworkData, input: ScoreInput): Score {
  // 服务质量:未送达率 + 平均超载率的惩罚
  const unservedRatio =
    input.metroDemandTrips > 0 ? input.unservedTrips / input.metroDemandTrips : 0;
  let crowdSum = 0;
  let segCount = 0;
  for (const lf of input.loadFactors) {
    for (const v of lf) {
      crowdSum += Math.max(0, v - 1);
      segCount++;
    }
  }
  const crowdAvg = segCount > 0 ? crowdSum / segCount : 0;
  const serviceQuality = clamp(
    1 - unservedRatio - SCORE_CROWD_WEIGHT * Math.min(crowdAvg, 1),
    SERVICE_QUALITY_FLOOR,
    1,
  );

  // 站均客流:只算接入线路的车站(孤立站不投运)
  const active = new Set<string>();
  for (const line of net.lines) for (const sid of line.stationIds) active.add(sid);
  const intensity = active.size > 0 ? input.servedTrips / active.size : 0;
  const recovery = input.totalCost > 0 ? input.fareRevenue / input.totalCost : null;

  const raw: { key: ScoreKey; value: number | null; ref: number; gamma: number }[] = [
    {
      key: "coverage",
      value: input.coverageRatio,
      ref: SCORE_REF.coverage,
      gamma: SCORE_GAMMA.coverage,
    },
    { key: "volume", value: input.servedTrips, ref: SCORE_REF.volume, gamma: SCORE_GAMMA.volume },
    {
      key: "intensity",
      value: intensity,
      ref: SCORE_REF.intensity,
      gamma: SCORE_GAMMA.intensity,
    },
    {
      key: "service",
      value: serviceQuality,
      ref: SCORE_REF.service,
      gamma: SCORE_GAMMA.service,
    },
    { key: "economy", value: recovery, ref: SCORE_REF.economy, gamma: SCORE_GAMMA.economy },
  ];

  // 没有客流 = 系统不成立,所有分项归零(避免空网络靠"服务质量满分"拿分)
  const dead = input.servedTrips <= 0;
  const present = raw.filter((d) => d.value !== null);
  const weightSum = present.reduce((s, d) => s + SCORE_WEIGHT[d.key], 0);

  const parts: ScorePart[] = present.map((d) => ({
    key: d.key,
    score: dead ? 0 : partScore(d.value!, d.ref, d.gamma),
    weight: weightSum > 0 ? SCORE_WEIGHT[d.key] / weightSum : 0,
    value: dead ? 0 : d.value!,
    ref: d.ref,
  }));
  parts.sort((a, b) => b.weight - a.weight);

  const rating = parts.reduce((sum, p) => sum + p.score * p.weight, 0);
  return { rating, grade: letterGrade(rating), serviceQuality, parts };
}
