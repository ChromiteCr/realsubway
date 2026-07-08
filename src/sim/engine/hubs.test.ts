import { describe, expect, it } from "vitest";
import { Network } from "../../model/network";
import { DataGrid, type GridMeta } from "../grids";
import { runSimulation } from "./index";
import { addHubOD } from "./hubs";
import { gravityOD } from "./od";
import { computeStationWeights, type Landmark } from "./weights";

function makeMeta(): GridMeta {
  return {
    bbox: { lngMin: 116.392, latMin: 39.8935, lngMax: 116.408, latMax: 39.9065 },
    width: 8,
    height: 8,
  };
}
function uniformGrid(value: number): DataGrid {
  const meta = makeMeta();
  return new DataGrid(meta, new Uint16Array(meta.width * meta.height).fill(value));
}

/** 机场地标 + 城区若干站的场景 */
function airportScene(withAirportStation: boolean) {
  const net = new Network();
  // 城区三站(有人口栅格)
  const a = net.addStation(116.396, 39.9);
  const b = net.addStation(116.4, 39.9);
  const c = net.addStation(116.404, 39.9);
  const l = net.addLine();
  for (const s of [a, b, c]) net.appendStationToLine(l.id, s.id);
  let airportId: string | null = null;
  if (withAirportStation) {
    // 机场站,接到城区线末端
    const air = net.addStation(116.42, 39.9); // 距机场地标 <4km
    net.appendStationToLine(l.id, air.id);
    airportId = air.id;
  }
  const airport: Landmark = { name: "机场", lng: 116.42, lat: 39.9, dailyTrips: 60000, hub: true };
  return { net, airportId, airport, cityStations: [a.id, b.id, c.id] };
}

describe("addHubOD 外生客流", () => {
  it("枢纽接入网络 → 枢纽站进出站量跃升到 dailyTrips 量级", () => {
    const grid = uniformGrid(500);
    const { net, airportId, airport } = airportScene(true);
    const withHub = runSimulation(net.toJSON(), grid, null, [airport]);
    const idx = withHub.stationIds.indexOf(airportId!);
    // 无枢纽客流时机场站几乎为 0(无居住无就业);有枢纽后应达数万
    expect(withHub.stationRiders[idx]!).toBeGreaterThan(20000);
  });

  it("枢纽未接入(最近站超上限)→ 不产生任何枢纽客流", () => {
    const grid = uniformGrid(500);
    const { net } = airportScene(false);
    // 机场地标远在 10km 外,城区站最近也 >4km
    const farAirport: Landmark = {
      name: "远机场",
      lng: 116.55,
      lat: 39.9,
      dailyTrips: 60000,
      hub: true,
    };
    const base = runSimulation(net.toJSON(), grid, null, []);
    const withFarHub = runSimulation(net.toJSON(), grid, null, [farAirport]);
    // 未接入枢纽:总运输量不应因枢纽而变化
    expect(withFarHub.servedTrips).toBeCloseTo(base.servedTrips, 0);
  });

  it("枢纽客流随 dailyTrips 单调放大", () => {
    const grid = uniformGrid(500);
    const { net, airportId } = airportScene(true);
    const small = runSimulation(net.toJSON(), grid, null, [
      { name: "机场", lng: 116.42, lat: 39.9, dailyTrips: 20000, hub: true },
    ]);
    const big = runSimulation(net.toJSON(), grid, null, [
      { name: "机场", lng: 116.42, lat: 39.9, dailyTrips: 80000, hub: true },
    ]);
    const si = small.stationIds.indexOf(airportId!);
    const bi = big.stationIds.indexOf(airportId!);
    expect(big.stationRiders[bi]!).toBeGreaterThan(small.stationRiders[si]! * 2);
  });

  it("直接叠加:出发写入 W[i][hub],到达写入 W[hub][j]", () => {
    const grid = uniformGrid(500);
    const { net, airport } = airportScene(true);
    const data = net.toJSON();
    const weights = computeStationWeights(data.stations, grid, null, []);
    const W = gravityOD(data.stations, weights);
    const n = data.stations.length;
    const hubIdx = 3; // 第四个站是机场站
    const before = { toHub: 0, fromHub: 0 };
    for (let i = 0; i < n; i++) before.toHub += W[i * n + hubIdx]!;
    for (let j = 0; j < n; j++) before.fromHub += W[hubIdx * n + j]!;
    const connected = addHubOD(W, data.stations, weights, [airport]);
    let toHub = 0;
    let fromHub = 0;
    for (let i = 0; i < n; i++) toHub += W[i * n + hubIdx]!;
    for (let j = 0; j < n; j++) fromHub += W[hubIdx * n + j]!;
    expect(connected).toBe(1);
    expect(toHub).toBeGreaterThan(before.toHub); // 出发半程叠加
    expect(fromHub).toBeGreaterThan(before.fromHub); // 到达半程叠加
    // 两半各 F/4 单向质量
    expect(toHub - before.toHub).toBeCloseTo(60000 / 4, 0);
    expect(fromHub - before.fromHub).toBeCloseTo(60000 / 4, 0);
  });

  it("吸引型地标(非枢纽)不走此路径,addHubOD 忽略", () => {
    const grid = uniformGrid(500);
    const { net, airport } = airportScene(true);
    const data = net.toJSON();
    const weights = computeStationWeights(data.stations, grid, null, []);
    const W = gravityOD(data.stations, weights);
    const attractionLandmark: Landmark = { name: "商圈", lng: 116.4, lat: 39.9, dailyTrips: 50000 };
    const connected = addHubOD(W, data.stations, weights, [attractionLandmark, airport]);
    expect(connected).toBe(1); // 只有机场被算作枢纽
  });
});
