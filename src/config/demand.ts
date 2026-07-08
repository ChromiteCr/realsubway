/**
 * 客流估算参数。数值为临时标定,M5 用真实现网 headless 校准。
 */

/** 站点集水区半径(米):超出此距离的格子不贡献客流 */
export const CATCHMENT_RADIUS_M = 800;

/** 高斯距离衰减的 σ(米) */
export const CATCHMENT_SIGMA_M = 350;

/**
 * 集水区常住人口的日潜在通勤率(人口端潜在出行,含目前不坐地铁的通勤者)。
 * 实际地铁出行 = 潜在出行 × logit 方式分担(见 config/simulation.ts)。
 */
export const POTENTIAL_RATE = 0.55;

/** 全市吸引端(就业/商业)日出行总池,按吸引权重占比摊到格子 */
export const ATTRACTION_TRIPS_POOL = 4_000_000;

/** 地标客流分给这个半径内的车站 */
export const LANDMARK_RADIUS_M = 700;

/**
 * 交通枢纽(机场/火车站)的外生客流分给最近车站的距离上限(公里)。
 * 超过 = 枢纽未接入网络,不产生地铁客流。机场航站楼群摊得开,故取值较大。
 */
export const HUB_MAX_DIST_KM = 4;
