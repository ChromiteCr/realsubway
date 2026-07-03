/**
 * 客流估算参数。数值为临时标定,M5 用真实现网 headless 校准。
 */

/** 站点集水区半径(米):超出此距离的格子不贡献客流 */
export const CATCHMENT_RADIUS_M = 800;

/** 高斯距离衰减的 σ(米) */
export const CATCHMENT_SIGMA_M = 350;

/** 集水区常住人口的日乘车率(人口端出行) */
export const TRIP_RATE = 0.3;

/** 全市吸引端(就业/商业)日出行总池,按吸引权重占比摊到格子 */
export const ATTRACTION_TRIPS_POOL = 4_000_000;

/** 地标客流分给这个半径内的车站 */
export const LANDMARK_RADIUS_M = 700;
