/// <reference lib="webworker" />
import type { NetworkData } from "../model/types";
import { runSimulation, type Landmark } from "./engine";
import { DataGrid, type GridMeta } from "./grids";

export interface InitMsg {
  type: "init";
  pop: { meta: GridMeta; data: Uint16Array } | null;
  attr: { meta: GridMeta; data: Uint16Array } | null;
  landmarks: Landmark[];
}

export interface NetworkMsg {
  type: "network";
  seq: number;
  net: NetworkData;
}

export type WorkerRequest = InitMsg | NetworkMsg;

let popGrid: DataGrid | null = null;
let attrGrid: DataGrid | null = null;
let landmarks: Landmark[] = [];

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    popGrid = msg.pop ? new DataGrid(msg.pop.meta, msg.pop.data) : null;
    attrGrid = msg.attr ? new DataGrid(msg.attr.meta, msg.attr.data) : null;
    landmarks = msg.landmarks;
    return;
  }
  const result = runSimulation(msg.net, popGrid, attrGrid, landmarks);
  // typed array 用 transfer 避免拷贝
  const transfers = [
    result.stationRiders.buffer,
    ...result.segLoads.map((a) => a.buffer),
  ];
  (self as unknown as Worker).postMessage({ type: "result", seq: msg.seq, result }, transfers);
};
