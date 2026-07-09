import { describe, expect, it } from "vitest";
import { fareForKm } from "../../config/economy";
import { Network } from "../../model/network";
import { computeEconomy } from "./economy";
import { letterGrade } from "./scoring";

describe("fareForKm 北京里程计价", () => {
  it("分段票价正确", () => {
    expect(fareForKm(0)).toBe(3);
    expect(fareForKm(6)).toBe(3);
    expect(fareForKm(6.1)).toBe(4);
    expect(fareForKm(12)).toBe(4);
    expect(fareForKm(22)).toBe(5);
    expect(fareForKm(32)).toBe(6);
    expect(fareForKm(52)).toBe(7); // 32 + 20
    expect(fareForKm(72)).toBe(8);
  });
  it("单调不减", () => {
    let prev = 0;
    for (let km = 0; km <= 100; km += 0.5) {
      const f = fareForKm(km);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe("computeEconomy", () => {
  function twoStationNet() {
    const net = new Network();
    const a = net.addStation(116.38, 39.9);
    const b = net.addStation(116.46, 39.9); // ~6.8km
    const l = net.addLine();
    net.appendStationToLine(l.id, a.id);
    net.appendStationToLine(l.id, b.id);
    return net;
  }

  it("利润 = 票款 − 运营 − 摊销", () => {
    const net = twoStationNet();
    const eco = computeEconomy(net.toJSON(), 1_000_000);
    expect(eco.fareRevenue).toBe(1_000_000);
    expect(eco.operatingCost).toBeGreaterThan(0);
    expect(eco.amortization).toBeGreaterThan(0);
    expect(eco.profitPerDay).toBeCloseTo(
      eco.fareRevenue - eco.operatingCost - eco.amortization,
      3,
    );
  });

  it("更长的线路 → 更高的建设摊销", () => {
    const short = new Network();
    const a = short.addStation(116.4, 39.9);
    const b = short.addStation(116.42, 39.9);
    const sl = short.addLine();
    short.appendStationToLine(sl.id, a.id);
    short.appendStationToLine(sl.id, b.id);

    const long = new Network();
    const c = long.addStation(116.3, 39.9);
    const d = long.addStation(116.6, 39.9);
    const ll = long.addLine();
    long.appendStationToLine(ll.id, c.id);
    long.appendStationToLine(ll.id, d.id);

    expect(computeEconomy(long.toJSON(), 0).amortization).toBeGreaterThan(
      computeEconomy(short.toJSON(), 0).amortization,
    );
  });

  it("加密班次(间隔更小)→ 运营成本与车队摊销都上升", () => {
    const net = twoStationNet();
    const line = net.lines[0]!;
    net.updateServicePlan(line.id, { headwayByHour: new Array(24).fill(12) });
    const sparse = computeEconomy(net.toJSON(), 0);
    net.updateServicePlan(line.id, { headwayByHour: new Array(24).fill(2) });
    const dense = computeEconomy(net.toJSON(), 0);
    expect(dense.operatingCost).toBeGreaterThan(sparse.operatingCost);
    expect(dense.amortization).toBeGreaterThan(sparse.amortization); // 更多运用车
  });

  it("空网络无成本", () => {
    const eco = computeEconomy({ version: 1, stations: [], lines: [] }, 0);
    expect(eco.operatingCost).toBe(0);
    expect(eco.amortization).toBe(0);
  });
});

describe("letterGrade 字母桶", () => {
  it("边界正确", () => {
    expect(letterGrade(97)).toBe("A+");
    expect(letterGrade(85)).toBe("B");
    expect(letterGrade(83)).toBe("B");
    expect(letterGrade(82.9)).toBe("B-");
    expect(letterGrade(59)).toBe("F");
  });
});
