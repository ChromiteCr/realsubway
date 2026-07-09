import {
  SCORE_CROWD_WEIGHT,
  SCORE_EFF_CAP,
  SCORE_EFF_FLOOR,
  SCORE_EFF_NORMAL,
  SCORE_SIGMA,
  SERVICE_QUALITY_FLOOR,
} from "../../config/economy";
import type { NetworkData } from "../../model/types";

export interface ScoreInput {
  servedTrips: number;
  metroDemandTrips: number;
  unservedTrips: number;
  loadFactors: Float32Array[];
}

export interface Score {
  /** 0–100+ 的数值评分 */
  rating: number;
  /** 字母等级 */
  grade: string;
  /** 服务质量系数 ∈ [floor,1](供 UI 解释) */
  serviceQuality: number;
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

/**
 * 综合评分(M5):客流对数项 + 效率项(客流/站台密度)再乘服务质量系数。
 * σ 已标定使真实北京现网 ≈ B(见 scoring.test.ts)。纯聚合,内存可忽略。
 */
export function computeScore(net: NetworkData, input: ScoreInput): Score {
  // 规模项:站台数(线内成员数)+ 接入的车站数
  let platforms = 0;
  const activeStations = new Set<string>();
  for (const line of net.lines) {
    platforms += line.stationIds.length;
    for (const sid of line.stationIds) activeStations.add(sid);
  }
  const denom = activeStations.size + platforms;

  // 主项:绝对客流(覆盖度)的对数
  const ridersM = input.servedTrips / 1e6;
  const ridershipTerm = Math.log(ridersM + 1);
  // 效率乘子:每站客流相对基准,钳到 [floor, cap],防小线刷分
  const perStation = denom > 0 ? input.servedTrips / denom : 0;
  const effMultiplier = clamp(perStation / SCORE_EFF_NORMAL, SCORE_EFF_FLOOR, SCORE_EFF_CAP);

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

  const rating = SCORE_SIGMA * ridershipTerm * effMultiplier * serviceQuality;
  return { rating, grade: letterGrade(rating), serviceQuality };
}
