import { HUB_MAX_DIST_KM } from "../../config/demand";
import { haversineKm } from "../../model/geo";
import type { StationData } from "../../model/types";
import type { Landmark, StationWeights } from "./weights";

/**
 * 交通枢纽外生客流(M4Y)。机场/火车站是零常住人口但产生真实地铁客流的枢纽,
 * 居住引力模型产不出。这里把每个枢纽的日客流当作**外生 OD**,就地叠加到 W 上:
 *   - 分给最近车站(超 HUB_MAX_DIST_KM 则枢纽未接入,不产生客流);
 *   - 出发半程:各站 i → 枢纽站,∝ production_i(居住地);
 *   - 到达半程:枢纽站 → 各站 j,∝ attraction_j + production_j(就业+居住);
 *   - 两半都**不走陡峭距离衰减**——机场 access 本就是长距离出行。
 * 之后照走同一套 logit 方式选择 + 分配 + 容量截断(assignOD)。
 *
 * 量级:assignOD 按往返计两腿(每条 OD ×2),两半各取单向质量 F/4,
 * 使枢纽站日进出站 ≈ F(dailyTrips 的语义)。返回实际接入的枢纽数。
 */
export function addHubOD(
  W: Float32Array,
  stations: StationData[],
  weights: StationWeights,
  landmarks: Landmark[],
): number {
  const n = stations.length;
  if (n < 2) return 0;
  let connected = 0;

  for (const hub of landmarks) {
    if (!hub.hub) continue;

    // 最近车站
    let sIdx = -1;
    let bestKm = Infinity;
    for (let i = 0; i < n; i++) {
      const d = haversineKm(stations[i]!, hub);
      if (d < bestKm) {
        bestKm = d;
        sIdx = i;
      }
    }
    if (sIdx < 0 || bestKm > HUB_MAX_DIST_KM) continue;
    connected++;

    const perDir = hub.dailyTrips / 4;

    // 出发:各站 i → 枢纽站,∝ production_i
    let prodSum = 0;
    for (let i = 0; i < n; i++) if (i !== sIdx) prodSum += weights.production[i]!;
    if (prodSum > 0) {
      for (let i = 0; i < n; i++) {
        if (i === sIdx) continue;
        W[i * n + sIdx]! += (perDir * weights.production[i]!) / prodSum;
      }
    }

    // 到达:枢纽站 → 各站 j,∝ attraction_j + production_j
    let attrSum = 0;
    for (let j = 0; j < n; j++) {
      if (j !== sIdx) attrSum += weights.attraction[j]! + weights.production[j]!;
    }
    if (attrSum > 0) {
      for (let j = 0; j < n; j++) {
        if (j === sIdx) continue;
        const w = weights.attraction[j]! + weights.production[j]!;
        W[sIdx * n + j]! += (perDir * w) / attrSum;
      }
    }
  }

  return connected;
}
