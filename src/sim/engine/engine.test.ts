import { describe, expect, it } from "vitest";
import { AM_PROFILE, PM_PROFILE, TRANSFER_WALK_MIN } from "../../config/simulation";
import { Network } from "../../model/network";
import { DataGrid, type GridMeta } from "../grids";
import { runSimulation } from "./index";
import { assignOD } from "./assign";
import { avgWaitMin, buildGraph, dijkstra } from "./graph";
import { gravityOD } from "./od";
import { computeStationWeights } from "./weights";

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

describe("computeStationWeights", () => {
  it("人口高格一侧的站生产量更高", () => {
    const meta = makeMeta();
    const data = new Uint16Array(meta.width * meta.height);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) data[r * 8 + c] = 1000;
    const grid = new DataGrid(meta, data);
    const net = new Network();
    net.addStation(116.394, 39.9);
    net.addStation(116.406, 39.9);
    const w = computeStationWeights(net.stations, grid, null, []);
    expect(w.production[0]!).toBeGreaterThan(w.production[1]! * 3);
  });

  it("相邻两站分摊同一格,合计生产量不因多建站翻倍", () => {
    const grid = uniformGrid(500);
    const netA = new Network();
    netA.addStation(116.4, 39.9);
    const single = computeStationWeights(netA.stations, grid, null, []).production[0]!;

    const netB = new Network();
    netB.addStation(116.4, 39.9);
    netB.addStation(116.4005, 39.9);
    const w = computeStationWeights(netB.stations, grid, null, []);
    const double = w.production[0]! + w.production[1]!;
    expect(double).toBeLessThan(single * 1.3);
  });

  it("地标就近分摊到两端权重", () => {
    const net = new Network();
    net.addStation(116.4, 39.9);
    const w = computeStationWeights(
      net.stations,
      null,
      null,
      [{ name: "T", lng: 116.4, lat: 39.9, dailyTrips: 10000 }],
    );
    expect(w.production[0]! + w.attraction[0]!).toBeCloseTo(10000, 3);
  });
});

describe("graph + dijkstra", () => {
  function threeStationLine() {
    const net = new Network();
    const a = net.addStation(116.38, 39.9);
    const b = net.addStation(116.4, 39.9);
    const c = net.addStation(116.42, 39.9);
    const l = net.addLine();
    for (const s of [a, b, c]) net.appendStationToLine(l.id, s.id);
    return { net, a, b, c, l };
  }

  it("同线两站可达,时间随距离单调", () => {
    const { net } = threeStationLine();
    const g = buildGraph(net.toJSON());
    const { dist } = dijkstra(g, 0);
    expect(dist[1]!).toBeGreaterThan(0);
    expect(dist[2]!).toBeGreaterThan(dist[1]!);
    expect(Number.isFinite(dist[2]!)).toBe(true);
  });

  it("不在任何线上的站不可达", () => {
    const { net } = threeStationLine();
    net.addStation(116.5, 39.95); // 孤立站,街面节点 3
    const g = buildGraph(net.toJSON());
    const { dist } = dijkstra(g, 0);
    expect(dist[3]!).toBe(Infinity);
  });

  it("换乘要付出下车+候车的代价", () => {
    // 一条线直达 vs 两条线在中间站换乘,直达应更快
    const direct = new Network();
    const stations = [
      direct.addStation(116.38, 39.9),
      direct.addStation(116.4, 39.9),
      direct.addStation(116.42, 39.9),
    ];
    const dl = direct.addLine();
    for (const s of stations) direct.appendStationToLine(dl.id, s.id);
    const gDirect = buildGraph(direct.toJSON());
    const tDirect = dijkstra(gDirect, 0).dist[2]!;

    const split = new Network();
    const s2 = [
      split.addStation(116.38, 39.9),
      split.addStation(116.4, 39.9),
      split.addStation(116.42, 39.9),
    ];
    const l1 = split.addLine();
    const l2 = split.addLine();
    split.appendStationToLine(l1.id, s2[0]!.id);
    split.appendStationToLine(l1.id, s2[1]!.id);
    split.appendStationToLine(l2.id, s2[1]!.id);
    split.appendStationToLine(l2.id, s2[2]!.id);
    const gSplit = buildGraph(split.toJSON());
    const tSplit = dijkstra(gSplit, 0).dist[2]!;

    expect(tSplit).toBeGreaterThan(tDirect + TRANSFER_WALK_MIN / 2);
  });

  it("平均候车 = 平均间隔的一半", () => {
    const net = new Network();
    const l = net.addLine();
    l.servicePlan.headwayByHour.fill(8);
    expect(avgWaitMin(l)).toBeCloseTo(4, 6);
  });
});

describe("gravityOD", () => {
  it("行和 = production/2,对角为 0", () => {
    const net = new Network();
    net.addStation(116.38, 39.9);
    net.addStation(116.4, 39.9);
    net.addStation(116.42, 39.9);
    const weights = {
      production: new Float64Array([1000, 500, 0]),
      attraction: new Float64Array([100, 300, 600]),
    };
    const W = gravityOD(net.stations, weights);
    const n = 3;
    for (let i = 0; i < n; i++) {
      let rowSum = 0;
      for (let j = 0; j < n; j++) rowSum += W[i * n + j]!;
      expect(rowSum).toBeCloseTo(weights.production[i]! / 2, 4);
      expect(W[i * n + i]!).toBe(0);
    }
  });

  it("吸引量大且更近的目的地拿到更多出行", () => {
    const net = new Network();
    net.addStation(116.38, 39.9); // 起点
    net.addStation(116.4, 39.9); // 近,吸引同
    net.addStation(116.46, 39.9); // 远,吸引同
    const weights = {
      production: new Float64Array([1000, 0, 0]),
      attraction: new Float64Array([0, 500, 500]),
    };
    const W = gravityOD(net.stations, weights);
    expect(W[0 * 3 + 1]!).toBeGreaterThan(W[0 * 3 + 2]!);
  });
});

describe("assignOD", () => {
  it("流量守恒:送达+未送达 = 2×ΣW;断面等于经过量", () => {
    const net = new Network();
    const a = net.addStation(116.38, 39.9);
    const b = net.addStation(116.4, 39.9);
    const c = net.addStation(116.42, 39.9);
    const l = net.addLine();
    for (const s of [a, b, c]) net.appendStationToLine(l.id, s.id);
    const n = 3;
    const W = new Float32Array(n * n);
    W[0 * n + 2] = 100; // a→c,穿过两个区间
    W[1 * n + 0] = 50; // b→a
    const res = assignOD(net.toJSON(), W);
    // 送达+未送达守恒;运营时段外(23时后回程份额)会有少量流失
    expect(res.servedTrips + res.unservedTrips).toBeCloseTo(300, 1);
    expect(res.servedTrips).toBeGreaterThan(280);
    expect(res.servedTrips).toBeLessThan(300);
    expect(res.unreachableTrips).toBe(0);
    const loads = res.segLoads[0]!;
    expect(loads[0 * 2 + 0]).toBeCloseTo(100, 3); // 区间0 顺向: a→c
    expect(loads[0 * 2 + 1]).toBeCloseTo(50, 3); // 区间0 逆向: b→a
    expect(loads[1 * 2 + 0]).toBeCloseTo(100, 3); // 区间1 顺向: a→c
  });

  it("不连通的 OD 计入无法到达", () => {
    const net = new Network();
    const a = net.addStation(116.38, 39.9);
    const b = net.addStation(116.4, 39.9);
    net.addStation(116.5, 39.95); // 孤立站
    const l = net.addLine();
    net.appendStationToLine(l.id, a.id);
    net.appendStationToLine(l.id, b.id);
    const n = 3;
    const W = new Float32Array(n * n);
    W[0 * n + 1] = 10;
    W[0 * n + 2] = 5; // 去孤立站,不可达
    const res = assignOD(net.toJSON(), W);
    expect(res.servedTrips + res.unservedTrips).toBeCloseTo(20, 1);
    expect(res.unreachableTrips).toBeCloseTo(10, 3);
  });

  it("M4-2 完成标准:间隔 3→10 分钟出现高峰未送达且运输总量下降,6B 换 8A 吃掉拥挤", () => {
    const net = new Network();
    const a = net.addStation(116.38, 39.9);
    const b = net.addStation(116.4, 39.9);
    const l = net.addLine();
    net.appendStationToLine(l.id, a.id);
    net.appendStationToLine(l.id, b.id);
    const n = 2;
    const W = new Float32Array(n * n);
    W[0 * n + 1] = 100_000; // 大客流,3 分钟间隔的 6B(29400/h)在高峰也接近极限
    net.updateServicePlan(l.id, { headwayByHour: new Array(24).fill(3) });
    const dense = assignOD(net.toJSON(), W);

    net.updateServicePlan(l.id, { headwayByHour: new Array(24).fill(10) });
    const sparse = assignOD(net.toJSON(), W);
    expect(sparse.servedTrips).toBeLessThan(dense.servedTrips);
    expect(sparse.unservedTrips).toBeGreaterThan(dense.unservedTrips);
    // 满载率 >1:高峰拥挤可见
    expect(Math.max(...sparse.loadFactors[0]!)).toBeGreaterThan(1);

    // 同样 10 分钟间隔,6B 换 8A(1470→2480 定员)恢复大部分送达
    net.updateServicePlan(l.id, { stock: { type: "A", cars: 8 } });
    const bigTrains = assignOD(net.toJSON(), W);
    expect(bigTrains.servedTrips).toBeGreaterThan(sparse.servedTrips);
    expect(Math.max(...bigTrains.loadFactors[0]!)).toBeLessThan(
      Math.max(...sparse.loadFactors[0]!),
    );
  });

  it("末班车提前导致晚间出行流失", () => {
    const net = new Network();
    const a = net.addStation(116.38, 39.9);
    const b = net.addStation(116.4, 39.9);
    const l = net.addLine();
    net.appendStationToLine(l.id, a.id);
    net.appendStationToLine(l.id, b.id);
    const n = 2;
    const W = new Float32Array(n * n);
    W[0 * n + 1] = 1000;
    const fullDay = assignOD(net.toJSON(), W);
    net.updateServicePlan(l.id, { lastTrainMin: 19 * 60 }); // 19:00 收车
    const earlyClose = assignOD(net.toJSON(), W);
    expect(earlyClose.servedTrips).toBeLessThan(fullDay.servedTrips * 0.9);
  });
});

describe("runSimulation 集成", () => {
  it("小网络端到端跑通,出行量与权重同量级", () => {
    const grid = uniformGrid(500);
    const net = new Network();
    const a = net.addStation(116.394, 39.898);
    const b = net.addStation(116.4, 39.902);
    const c = net.addStation(116.406, 39.905);
    const l = net.addLine();
    for (const s of [a, b, c]) net.appendStationToLine(l.id, s.id);
    const res = runSimulation(net.toJSON(), grid, null, []);
    expect(res.servedTrips).toBeGreaterThan(0);
    expect(res.unreachableTrips).toBe(0);
    expect(res.stationIds).toHaveLength(3);
  });
});

describe("服务计划影响分配", () => {
  it("并行双线竞争:间隔小的线赢得客流,编辑间隔后反转", () => {
    const grid = uniformGrid(500);
    const net = new Network();
    const a = net.addStation(116.394, 39.898);
    const b = net.addStation(116.406, 39.905);
    const fast = net.addLine("快线");
    const slow = net.addLine("慢线");
    for (const l of [fast, slow]) {
      net.appendStationToLine(l.id, a.id);
      net.appendStationToLine(l.id, b.id);
    }
    net.updateServicePlan(fast.id, { headwayByHour: new Array(24).fill(3) });
    net.updateServicePlan(slow.id, { headwayByHour: new Array(24).fill(15) });

    const res1 = runSimulation(net.toJSON(), grid, null, []);
    const load = (r: typeof res1, id: string) =>
      r.segLoads[r.lineIds.indexOf(id)]!.reduce((s, v) => s + v, 0);
    expect(load(res1, fast.id)).toBeGreaterThan(0);
    expect(load(res1, slow.id)).toBe(0);

    // 反转两线间隔,客流应跟着走
    net.updateServicePlan(fast.id, { headwayByHour: new Array(24).fill(15) });
    net.updateServicePlan(slow.id, { headwayByHour: new Array(24).fill(3) });
    const res2 = runSimulation(net.toJSON(), grid, null, []);
    expect(load(res2, slow.id)).toBeGreaterThan(0);
    expect(load(res2, fast.id)).toBe(0);
  });
});

describe("时变曲线", () => {
  it("早晚高峰曲线各自归一", () => {
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    expect(sum(AM_PROFILE)).toBeCloseTo(1, 9);
    expect(sum(PM_PROFILE)).toBeCloseTo(1, 9);
  });
});
