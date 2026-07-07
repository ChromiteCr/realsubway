import type { Feature, FeatureCollection } from "geojson";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { Network } from "../model/network";
import { buildLineTimetable, trainPositionsAt, type LineTimetable } from "../sim/timetable";

export const TRAINS_SOURCE = "trains";
export const TRAINS_LAYER = "trains-layer";

/** 全部列车渲染为单一 GeoJSON 图层,颜色取线路色 */
export function installTrainLayer(map: MlMap): void {
  map.addSource(TRAINS_SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: TRAINS_LAYER,
    type: "circle",
    source: TRAINS_SOURCE,
    paint: {
      "circle-radius": 4,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
    },
  });
}

/** 列车动画驱动:持有全网时刻表,网络变更时重建,时钟 tick 时刷新图层 */
export class TrainAnimator {
  private timetables: LineTimetable[] = [];
  /** 复用的坐标缓冲,避免每帧分配 */
  private scratch: number[] = [];

  constructor(
    private readonly map: MlMap,
    private readonly network: Network,
  ) {
    this.rebuild();
    network.subscribe(() => this.rebuild());
  }

  rebuild(): void {
    const byId = new Map(this.network.stations.map((s) => [s.id, s]));
    this.timetables = [];
    for (const line of this.network.lines) {
      const tt = buildLineTimetable(line, byId);
      if (tt) this.timetables.push(tt);
    }
  }

  /** 把 tMin 时刻的所有在途列车写入图层 */
  render(tMin: number): void {
    const source = this.map.getSource(TRAINS_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    const features: Feature[] = [];
    for (const tt of this.timetables) {
      for (const dir of tt.directions) {
        this.scratch.length = 0;
        trainPositionsAt(dir, tMin, this.scratch);
        for (let i = 0; i + 1 < this.scratch.length; i += 2) {
          features.push({
            type: "Feature",
            properties: { color: tt.color },
            geometry: { type: "Point", coordinates: [this.scratch[i]!, this.scratch[i + 1]!] },
          });
        }
      }
    }
    const fc: FeatureCollection = { type: "FeatureCollection", features };
    source.setData(fc);
  }

  trainCount(tMin: number): number {
    let n = 0;
    for (const tt of this.timetables) {
      for (const dir of tt.directions) {
        this.scratch.length = 0;
        trainPositionsAt(dir, tMin, this.scratch);
        n += this.scratch.length / 2;
      }
    }
    return n;
  }
}
