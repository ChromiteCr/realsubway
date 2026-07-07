import { DWELL_MIN, TRAIN_SPEED_KMH } from "../config/simulation";
import { haversineKm } from "../model/geo";
import type { LineData, StationData } from "../model/types";

/** 单方向时刻表:站序坐标 + 各站累计时间 + 全日发车时刻 */
export interface DirectionTimetable {
  /** [lng0,lat0,lng1,lat1,...] */
  coords: Float64Array;
  /** 到达第 k 站的累计分钟(发车时刻起算,k=0 为 0) */
  cum: Float64Array;
  /** 发车时刻(分钟,升序) */
  departures: Float64Array;
  tripDurationMin: number;
}

export interface LineTimetable {
  lineId: string;
  color: string;
  directions: [DirectionTimetable, DirectionTimetable];
}

function buildDeparturesForDay(line: LineData): Float64Array {
  const { firstTrainMin, lastTrainMin, headwayByHour } = line.servicePlan;
  const out: number[] = [];
  let t = firstTrainMin;
  while (t <= lastTrainMin) {
    out.push(t);
    t += headwayByHour[Math.min(23, Math.floor(t / 60))] ?? 6;
  }
  return Float64Array.from(out);
}

function buildDirection(stations: StationData[], departures: Float64Array): DirectionTimetable {
  const coords = new Float64Array(stations.length * 2);
  const cum = new Float64Array(stations.length);
  for (let k = 0; k < stations.length; k++) {
    coords[k * 2] = stations[k]!.lng;
    coords[k * 2 + 1] = stations[k]!.lat;
    if (k > 0) {
      const t = (haversineKm(stations[k - 1]!, stations[k]!) / TRAIN_SPEED_KMH) * 60 + DWELL_MIN;
      cum[k] = cum[k - 1]! + t;
    }
  }
  return {
    coords,
    cum,
    departures,
    tripDurationMin: cum[stations.length - 1] ?? 0,
  };
}

/** 站数 <2 或无法解析的线返回 null */
export function buildLineTimetable(
  line: LineData,
  stationById: Map<string, StationData>,
): LineTimetable | null {
  const stations = line.stationIds
    .map((id) => stationById.get(id))
    .filter((s): s is StationData => s !== undefined);
  if (stations.length < 2) return null;
  const departures = buildDeparturesForDay(line);
  return {
    lineId: line.id,
    color: line.color,
    directions: [
      buildDirection(stations, departures),
      buildDirection([...stations].reverse(), departures),
    ],
  };
}

/**
 * t 时刻单方向所有在途列车的位置,追加到 out(每列车 push lng,lat)。
 * 位置是时刻表的解析函数:二分找在途发车区间,再二分找所在区间插值。
 */
export function trainPositionsAt(dir: DirectionTimetable, tMin: number, out: number[]): void {
  const { departures, cum, coords, tripDurationMin } = dir;
  if (departures.length === 0 || tripDurationMin <= 0) return;
  // 在途条件: dep <= t <= dep+duration → dep ∈ [t-duration, t]
  let lo = lowerBound(departures, tMin - tripDurationMin);
  for (let i = lo; i < departures.length && departures[i]! <= tMin; i++) {
    const elapsed = tMin - departures[i]!;
    // 找 k 使 cum[k] <= elapsed <= cum[k+1]
    const k = upperBound(cum, elapsed) - 1;
    if (k < 0) continue;
    if (k >= cum.length - 1) {
      out.push(coords[(cum.length - 1) * 2]!, coords[(cum.length - 1) * 2 + 1]!);
      continue;
    }
    const segTime = cum[k + 1]! - cum[k]!;
    const f = segTime > 0 ? (elapsed - cum[k]!) / segTime : 0;
    out.push(
      coords[k * 2]! + (coords[(k + 1) * 2]! - coords[k * 2]!) * f,
      coords[k * 2 + 1]! + (coords[(k + 1) * 2 + 1]! - coords[k * 2 + 1]!) * f,
    );
  }
}

/** 第一个 >= x 的下标 */
function lowerBound(arr: Float64Array, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 第一个 > x 的下标 */
function upperBound(arr: Float64Array, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
