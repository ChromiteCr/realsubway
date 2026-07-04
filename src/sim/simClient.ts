import { AM_PROFILE, PM_PROFILE } from "../config/simulation";
import type { Network } from "../model/network";
import type { Landmark, SimResult } from "./engine";
import type { DataGrid } from "./grids";

type Listener = () => void;

export type SimState = "nodata" | "computing" | "ready";

/**
 * 主线程侧的模拟客户端:网络一变就(防抖后)丢给 Worker 重算,
 * 结果按序号去重,旧结果丢弃。UI 只读这里。
 */
export class SimClient {
  private worker: Worker;
  private listeners = new Set<Listener>();
  private seq = 0;
  private result: SimResult | null = null;
  private ridersById = new Map<string, number>();
  private segByLineId = new Map<string, Float32Array>();
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _state: SimState = "nodata";
  private _hasGrids = false;

  constructor(private readonly network: Network) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<{ seq: number; result: SimResult }>) => {
      if (ev.data.seq !== this.seq) return; // 过期结果
      this.result = ev.data.result;
      this.ridersById.clear();
      this.result.stationIds.forEach((id, i) =>
        this.ridersById.set(id, this.result!.stationRiders[i]!),
      );
      this.segByLineId.clear();
      this.result.lineIds.forEach((id, i) => this.segByLineId.set(id, this.result!.segLoads[i]!));
      this._state = "ready";
      this.emit();
    };
    network.subscribe(() => this.scheduleRecompute());
  }

  init(
    pop: DataGrid | null,
    attr: DataGrid | null,
    landmarks: Landmark[],
  ): void {
    this._hasGrids = pop !== null;
    this.worker.postMessage({
      type: "init",
      pop: pop ? { meta: pop.meta, data: pop.data } : null,
      attr: attr ? { meta: attr.meta, data: attr.data } : null,
      landmarks,
    });
    this.scheduleRecompute(0);
  }

  private scheduleRecompute(delayMs = 200): void {
    if (!this._hasGrids) return;
    this._state = "computing";
    this.emit();
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.seq++;
      this.worker.postMessage({ type: "network", seq: this.seq, net: this.network.toJSON() });
    }, delayMs);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  get state(): SimState {
    return this._state;
  }

  get hasData(): boolean {
    return this._hasGrids;
  }

  get computeMs(): number {
    return this.result?.computeMs ?? 0;
  }

  ridersAt(stationId: string): number {
    return this.ridersById.get(stationId) ?? 0;
  }

  /** 日送达出行量(全网) */
  total(): number {
    return this.result?.servedTrips ?? 0;
  }

  unreachable(): number {
    return this.result?.unreachableTrips ?? 0;
  }

  /** 区间日断面(单向;去程+回程,双向对称) */
  segDaily(lineId: string, seg: number): number {
    const loads = this.segByLineId.get(lineId);
    if (!loads) return 0;
    return (loads[seg * 2] ?? 0) + (loads[seg * 2 + 1] ?? 0);
  }

  /** 区间早/晚高峰最忙单向断面(人次/小时)及方向(0=顺 1=逆) */
  segPeak(lineId: string, seg: number): { load: number; dirBit: number } {
    const loads = this.segByLineId.get(lineId);
    if (!loads) return { load: 0, dirBit: 0 };
    const fw = loads[seg * 2] ?? 0;
    const bw = loads[seg * 2 + 1] ?? 0;
    let best = 0;
    let bestDir = 0;
    for (let h = 0; h < 24; h++) {
      const loadFw = fw * AM_PROFILE[h]! + bw * PM_PROFILE[h]!;
      const loadBw = bw * AM_PROFILE[h]! + fw * PM_PROFILE[h]!;
      if (loadFw > best) {
        best = loadFw;
        bestDir = 0;
      }
      if (loadBw > best) {
        best = loadBw;
        bestDir = 1;
      }
    }
    return { load: best, dirBit: bestDir };
  }
}
