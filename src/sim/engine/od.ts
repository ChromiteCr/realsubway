import { GRAVITY_BETA, GRAVITY_MIN_KM } from "../../config/simulation";
import { haversineKm } from "../../model/geo";
import type { StationData } from "../../model/types";
import type { StationWeights } from "./weights";

/**
 * 引力模型生成"去程"OD 矩阵 W(行主序 n×n,W[i*n+j] = 家 i → 目的地 j 的日出行):
 *   W_ij ∝ A_j / max(d_ij, dmin)^β,行归一使 Σ_j W_ij = production_i / 2
 * (另一半出行是回程 Wᵀ,由调用方在分配时处理;i==j 不出行)
 */
export function gravityOD(stations: StationData[], weights: StationWeights): Float32Array {
  const n = stations.length;
  const W = new Float32Array(n * n);
  if (n < 2) return W;

  for (let i = 0; i < n; i++) {
    const si = stations[i]!;
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = Math.max(haversineKm(si, stations[j]!), GRAVITY_MIN_KM);
      const v = weights.attraction[j]! / Math.pow(d, GRAVITY_BETA);
      W[i * n + j] = v;
      rowSum += v;
    }
    if (rowSum <= 0) continue;
    const scale = weights.production[i]! / 2 / rowSum;
    for (let j = 0; j < n; j++) W[i * n + j] = W[i * n + j]! * scale;
  }
  return W;
}
