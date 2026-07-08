import { haversineKm } from "./geo";

export type PlaceKind = "station" | "landmark" | "place";

export interface NamedPoint {
  name: string;
  lng: number;
  lat: number;
  kind: PlaceKind;
}

/** 各类命名点的采用半径(米):点击超出此距离则该点不作为命名来源 */
const RADIUS_M: Record<PlaceKind, number> = {
  station: 500,
  landmark: 1000,
  place: 2000,
};

/** 命名优先级(数字越小越优先):真实站名 > 地标 > 片区名 */
const PRIORITY: Record<PlaceKind, number> = {
  station: 0,
  landmark: 1,
  place: 2,
};

/** 相对命名点的四向方位(用于重名消歧,仿"天安门东/西") */
function direction(from: { lng: number; lat: number }, to: { lng: number; lat: number }): string {
  const dLng = to.lng - from.lng;
  const dLat = to.lat - from.lat;
  if (Math.abs(dLng) >= Math.abs(dLat)) return dLng >= 0 ? "东" : "西";
  return dLat >= 0 ? "北" : "南";
}

/**
 * 地名索引:真实站名 + 地标 + OSM 片区名的合集。
 * 给定点击位置,按优先级档回退取一个地道站名;纯数据、可 headless 测试。
 */
export class Gazetteer {
  constructor(private readonly points: NamedPoint[]) {}

  get size(): number {
    return this.points.length;
  }

  /** 最优命名来源点:先按优先级档、再按档内最近;都不在半径内返回 null */
  private best(lng: number, lat: number): NamedPoint | null {
    let winner: NamedPoint | null = null;
    let bestPri = Infinity;
    let bestDist = Infinity;
    for (const p of this.points) {
      const d = haversineKm({ lng, lat }, p) * 1000;
      if (d > RADIUS_M[p.kind]) continue;
      const pri = PRIORITY[p.kind];
      if (pri < bestPri || (pri === bestPri && d < bestDist)) {
        winner = p;
        bestPri = pri;
        bestDist = d;
      }
    }
    return winner;
  }

  /**
   * 建议站名。命中时按优先级回退取名,与 existingNames 重名时依次尝试
   * 加方位、加方位+序号消歧;无命中返回 null(调用方回落到"车站N")。
   */
  suggest(lng: number, lat: number, existingNames: Set<string>): string | null {
    const src = this.best(lng, lat);
    if (!src) return null;
    if (!existingNames.has(src.name)) return src.name;

    const dir = direction(src, { lng, lat });
    const withDir = src.name + dir;
    if (!existingNames.has(withDir)) return withDir;

    for (let i = 2; i < 1000; i++) {
      const cand = `${src.name}${dir}${i}`;
      if (!existingNames.has(cand)) return cand;
    }
    return null;
  }
}

/** 从三类来源构建 Gazetteer;任一来源可缺省 */
export function buildGazetteer(sources: {
  stations?: { name: string; lng: number; lat: number }[];
  landmarks?: { name: string; lng: number; lat: number }[];
  places?: { name: string; lng: number; lat: number }[];
}): Gazetteer {
  const pts: NamedPoint[] = [];
  for (const s of sources.stations ?? []) pts.push({ ...s, kind: "station" });
  for (const s of sources.landmarks ?? []) pts.push({ ...s, kind: "landmark" });
  for (const s of sources.places ?? []) pts.push({ ...s, kind: "place" });
  return new Gazetteer(pts);
}
