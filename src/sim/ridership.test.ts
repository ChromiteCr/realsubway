import { describe, expect, it } from "vitest";
import { Network } from "../model/network";
import { DataGrid, type GridMeta } from "./grids";
import { RidershipModel } from "./ridership";

/**
 * 8×8 测试栅格,覆盖约 1.4km×1.4km(北京纬度),格边长约 180m。
 * 中心 (116.4, 39.9)。
 */
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

describe("RidershipModel", () => {
  it("无数据栅格时优雅降级为 0,不抛错", () => {
    const net = new Network();
    net.addStation(116.4, 39.9);
    const model = new RidershipModel(net, null, null, []);
    expect(model.total()).toBe(0);
    expect(model.hasData).toBe(false);
  });

  it("市中心站(人口高格)客流高于郊区站(人口 0 格)", () => {
    const meta = makeMeta();
    const data = new Uint16Array(meta.width * meta.height);
    // 西半边人口 1000,东半边 0
    for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) data[r * 8 + c] = 1000;
    const grid = new DataGrid(meta, data);
    const net = new Network();
    const west = net.addStation(116.394, 39.9);
    const east = net.addStation(116.406, 39.9);
    const model = new RidershipModel(net, grid, null, []);
    expect(model.ridersAt(west.id)).toBeGreaterThan(model.ridersAt(east.id) * 3);
  });

  it("两个相邻站分摊同一格,总量不因多建站而翻倍", () => {
    const grid = uniformGrid(500);
    const netA = new Network();
    netA.addStation(116.4, 39.9);
    const single = new RidershipModel(netA, grid, null, []).total();

    const netB = new Network();
    netB.addStation(116.4, 39.9);
    netB.addStation(116.4005, 39.9); // 相距 ~45m,集水区几乎重合
    const double = new RidershipModel(netB, grid, null, []).total();

    // 分流机制下,两站合计只应比单站略多(边缘格),而不是接近 2 倍
    expect(double).toBeLessThan(single * 1.3);
    expect(double).toBeGreaterThanOrEqual(single * 0.99);
  });

  it("换乘站获得 ln(n)+1 加成", () => {
    const grid = uniformGrid(500);
    const net = new Network();
    const s = net.addStation(116.4, 39.9);
    const other = net.addStation(116.406, 39.906);
    const l1 = net.addLine();
    const l2 = net.addLine();
    net.appendStationToLine(l1.id, s.id);
    net.appendStationToLine(l1.id, other.id);
    const model = new RidershipModel(net, grid, null, []);
    const before = model.ridersAt(s.id);
    net.appendStationToLine(l2.id, s.id); // s 变换乘站,自动触发 recompute
    const after = model.ridersAt(s.id);
    expect(after / before).toBeCloseTo(Math.log(2) + 1, 5);
  });

  it("地标客流分给半径内的站,无站则不分", () => {
    const net = new Network();
    const near = net.addStation(116.4, 39.9);
    net.addStation(116.407, 39.9065); // 远处的站(>700m)
    const landmarks = [
      { name: "测试地标", lng: 116.4, lat: 39.9, dailyTrips: 10000 },
      { name: "无人区地标", lng: 116.5, lat: 39.99, dailyTrips: 99999 },
    ];
    const model = new RidershipModel(net, null, null, landmarks);
    expect(model.ridersAt(near.id)).toBeCloseTo(10000, 3);
    expect(model.total()).toBeCloseTo(10000, 3); // 99999 没有站接住,不计入
  });

  it("网络变更自动重算并通知订阅者", () => {
    const grid = uniformGrid(100);
    const net = new Network();
    net.addStation(116.4, 39.9);
    const model = new RidershipModel(net, grid, null, []);
    const t1 = model.total();
    let notified = 0;
    model.subscribe(() => notified++);
    net.addStation(116.406, 39.9065);
    expect(model.total()).toBeGreaterThan(t1);
    expect(notified).toBe(1);
  });
});
