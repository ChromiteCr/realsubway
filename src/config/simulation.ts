/**
 * 出行结构与路径选择参数(M3)。数值为临时标定,M5 用现网校准。
 */

/** 列车旅行速度(km/h,含停站的通勤平均) */
export const TRAIN_SPEED_KMH = 35;

/** 每站停站附加(分钟),计入区间边权 */
export const DWELL_MIN = 0.5;

/** 进出站步行/闸机(分钟) */
export const ACCESS_MIN = 1.0;

/** 换乘通道步行(分钟),在候车之外额外付出 */
export const TRANSFER_WALK_MIN = 3.0;

/** 引力模型距离衰减指数:T_ij ∝ A_j / d^β */
export const GRAVITY_BETA = 1.6;

/** 距离衰减的最小距离(公里),避免近距爆炸 */
export const GRAVITY_MIN_KM = 1.5;

/** 早高峰逐时占比(去程 家→工作,按自然小时索引) */
export const AM_PROFILE = buildProfile({
  5: 0.02, 6: 0.08, 7: 0.2, 8: 0.21, 9: 0.11, 10: 0.06, 11: 0.05, 12: 0.05,
  13: 0.05, 14: 0.04, 15: 0.04, 16: 0.03, 17: 0.02, 18: 0.02, 19: 0.01, 20: 0.005, 21: 0.005,
});

/** 晚高峰逐时占比(回程 工作→家) */
export const PM_PROFILE = buildProfile({
  5: 0.0, 6: 0.005, 7: 0.005, 8: 0.01, 9: 0.02, 10: 0.03, 11: 0.04, 12: 0.05,
  13: 0.05, 14: 0.05, 15: 0.06, 16: 0.09, 17: 0.19, 18: 0.2, 19: 0.09, 20: 0.05,
  21: 0.03, 22: 0.02, 23: 0.01,
});

function buildProfile(shares: Record<number, number>): number[] {
  const arr = new Array<number>(24).fill(0);
  let sum = 0;
  for (const [h, v] of Object.entries(shares)) {
    arr[Number(h)] = v;
    sum += v;
  }
  // 归一化,容忍手写份额的小误差
  return arr.map((v) => v / sum);
}
