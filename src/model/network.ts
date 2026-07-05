import { pickLineColor } from "../config/colors";
import { defaultServicePlan } from "../config/rollingstock";
import type { LineData, NetworkData, ServicePlan, StationData } from "./types";

/** 服务计划的合法范围,编辑器与校验共用 */
export const PLAN_LIMITS = {
  headwayMin: 2,
  headwayMax: 30,
  carsMin: 2,
  carsMax: 10,
  /** 首末班车之间至少要有的运营时长(分钟) */
  minServiceSpan: 60,
} as const;

type Listener = () => void;

/**
 * 线网模型:车站与线路的唯一事实来源。
 * 渲染层与模拟引擎都只读它;一切变更经由方法调用并触发订阅。
 */
export class Network {
  private stationMap = new Map<string, StationData>();
  private lineMap = new Map<string, LineData>();
  private listeners = new Set<Listener>();
  private stationSeq = 0;
  private lineSeq = 0;

  get stations(): StationData[] {
    return [...this.stationMap.values()];
  }

  get lines(): LineData[] {
    return [...this.lineMap.values()];
  }

  getStation(id: string): StationData | undefined {
    return this.stationMap.get(id);
  }

  getLine(id: string): LineData | undefined {
    return this.lineMap.get(id);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  addStation(lng: number, lat: number, name?: string): StationData {
    const id = `s${++this.stationSeq}`;
    const station: StationData = { id, name: name ?? `车站${this.stationSeq}`, lng, lat };
    this.stationMap.set(id, station);
    this.emit();
    return station;
  }

  renameStation(id: string, name: string): void {
    const station = this.stationMap.get(id);
    if (!station || station.name === name) return;
    station.name = name;
    this.emit();
  }

  moveStation(id: string, lng: number, lat: number): void {
    const station = this.stationMap.get(id);
    if (!station) return;
    station.lng = lng;
    station.lat = lat;
    this.emit();
  }

  deleteStation(id: string): void {
    if (!this.stationMap.delete(id)) return;
    for (const line of this.lineMap.values()) {
      line.stationIds = line.stationIds.filter((sid) => sid !== id);
    }
    this.emit();
  }

  addLine(name?: string, color?: string): LineData {
    const id = `l${++this.lineSeq}`;
    const line: LineData = {
      id,
      name: name ?? `${this.lineSeq}号线`,
      color: color ?? pickLineColor(this.lineSeq - 1),
      stationIds: [],
      servicePlan: defaultServicePlan(),
    };
    this.lineMap.set(id, line);
    this.emit();
    return line;
  }

  deleteLine(id: string): void {
    if (this.lineMap.delete(id)) this.emit();
  }

  renameLine(id: string, name: string): void {
    const line = this.lineMap.get(id);
    if (!line || line.name === name) return;
    line.name = name;
    this.emit();
  }

  /** 部分更新服务计划;所有字段钳制到 PLAN_LIMITS 合法范围后生效 */
  updateServicePlan(lineId: string, patch: Partial<ServicePlan>): void {
    const line = this.lineMap.get(lineId);
    if (!line) return;
    const cur = line.servicePlan;
    const next: ServicePlan = {
      firstTrainMin: patch.firstTrainMin ?? cur.firstTrainMin,
      lastTrainMin: patch.lastTrainMin ?? cur.lastTrainMin,
      headwayByHour: (patch.headwayByHour ?? cur.headwayByHour).map((h) =>
        clamp(Math.round(h), PLAN_LIMITS.headwayMin, PLAN_LIMITS.headwayMax),
      ),
      stock: {
        type: patch.stock?.type ?? cur.stock.type,
        cars: clamp(
          Math.round(patch.stock?.cars ?? cur.stock.cars),
          PLAN_LIMITS.carsMin,
          PLAN_LIMITS.carsMax,
        ),
      },
    };
    next.firstTrainMin = clamp(next.firstTrainMin, 0, 1439 - PLAN_LIMITS.minServiceSpan);
    next.lastTrainMin = clamp(
      next.lastTrainMin,
      next.firstTrainMin + PLAN_LIMITS.minServiceSpan,
      1439,
    );
    line.servicePlan = next;
    this.emit();
  }

  /** 把车站追加到线路末尾;与当前末站相同时拒绝,返回是否成功 */
  appendStationToLine(lineId: string, stationId: string): boolean {
    const line = this.lineMap.get(lineId);
    if (!line || !this.stationMap.has(stationId)) return false;
    if (line.stationIds[line.stationIds.length - 1] === stationId) return false;
    line.stationIds.push(stationId);
    this.emit();
    return true;
  }

  removeStationFromLine(lineId: string, stationId: string): void {
    const line = this.lineMap.get(lineId);
    if (!line) return;
    const next = line.stationIds.filter((sid) => sid !== stationId);
    if (next.length === line.stationIds.length) return;
    line.stationIds = next;
    this.emit();
  }

  linesThroughStation(stationId: string): LineData[] {
    return this.lines.filter((line) => line.stationIds.includes(stationId));
  }

  toJSON(): NetworkData {
    return {
      version: 1,
      stations: this.stations.map((s) => ({ ...s })),
      lines: this.lines.map((l) => ({
        ...l,
        stationIds: [...l.stationIds],
        servicePlan: {
          ...l.servicePlan,
          headwayByHour: [...l.servicePlan.headwayByHour],
          stock: { ...l.servicePlan.stock },
        },
      })),
    };
  }

  static fromJSON(data: NetworkData): Network {
    const net = new Network();
    for (const s of data.stations) net.stationMap.set(s.id, { ...s });
    for (const l of data.lines) {
      net.lineMap.set(l.id, {
        ...l,
        stationIds: [...l.stationIds],
        servicePlan: {
          ...l.servicePlan,
          headwayByHour: [...l.servicePlan.headwayByHour],
          stock: { ...l.servicePlan.stock },
        },
      });
    }
    net.stationSeq = maxSeq(data.stations.map((s) => s.id), "s");
    net.lineSeq = maxSeq(data.lines.map((l) => l.id), "l");
    return net;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function maxSeq(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}
