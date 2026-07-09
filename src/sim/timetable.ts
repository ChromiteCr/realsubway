import { DWELL_MIN, TRAIN_SPEED_KMH } from "../config/simulation";
import { haversineKm } from "../model/geo";
import type { LineData, StationData } from "../model/types";
import { segmentCurves } from "../render/lineGeometry";

/**
 * 单方向时刻表:沿轨道曲线加密后的折线 + 每点累计时间 + 全日发车时刻。
 * 列车沿曲线运行(与渲染同一几何);时段计时仍按站间直线距离(维持标定)。
 */
export interface DirectionTimetable {
  /** 加密曲线点 [lng0,lat0,lng1,lat1,...] */
  pts: Float64Array;
  /** 每个曲线点的累计分钟(发车时刻起算,首点为 0) */
  cumTime: Float64Array;
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
  const pos = stations.map((s): [number, number] => [s.lng, s.lat]);
  const curves = segmentCurves(pos);

  const ptsArr: number[] = [pos[0]![0], pos[0]![1]];
  const timeArr: number[] = [0];
  let stationTime = 0;

  for (let k = 0; k < curves.length; k++) {
    // 该区段到站时间按站间直线距离(维持既有标定),位置沿曲线按弧长分配
    const segTime =
      (haversineKm(stations[k]!, stations[k + 1]!) / TRAIN_SPEED_KMH) * 60 + DWELL_MIN;
    const curve = curves[k]!;
    let arc = 0;
    const arcAt: number[] = [0];
    for (let i = 1; i < curve.length; i++) {
      arc += haversineKm(
        { lng: curve[i - 1]![0]!, lat: curve[i - 1]![1]! },
        { lng: curve[i]![0]!, lat: curve[i]![1]! },
      );
      arcAt.push(arc);
    }
    const total = arc || 1;
    const t0 = stationTime;
    for (let i = 1; i < curve.length; i++) {
      ptsArr.push(curve[i]![0]!, curve[i]![1]!);
      timeArr.push(t0 + segTime * (arcAt[i]! / total));
    }
    stationTime = t0 + segTime;
  }

  return {
    pts: Float64Array.from(ptsArr),
    cumTime: Float64Array.from(timeArr),
    departures,
    tripDurationMin: stationTime,
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
  const { departures, cumTime, pts, tripDurationMin } = dir;
  if (departures.length === 0 || tripDurationMin <= 0) return;
  const lastPt = cumTime.length - 1;
  // 在途条件: dep <= t <= dep+duration → dep ∈ [t-duration, t]
  const lo = lowerBound(departures, tMin - tripDurationMin);
  for (let i = lo; i < departures.length && departures[i]! <= tMin; i++) {
    const elapsed = tMin - departures[i]!;
    // 找曲线点 j 使 cumTime[j] <= elapsed <= cumTime[j+1]
    const j = upperBound(cumTime, elapsed) - 1;
    if (j < 0) continue;
    if (j >= lastPt) {
      out.push(pts[lastPt * 2]!, pts[lastPt * 2 + 1]!);
      continue;
    }
    const dt = cumTime[j + 1]! - cumTime[j]!;
    const f = dt > 0 ? (elapsed - cumTime[j]!) / dt : 0;
    out.push(
      pts[j * 2]! + (pts[(j + 1) * 2]! - pts[j * 2]!) * f,
      pts[j * 2 + 1]! + (pts[(j + 1) * 2 + 1]! - pts[j * 2 + 1]!) * f,
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
