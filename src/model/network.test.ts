import { describe, expect, it } from "vitest";
import { Network } from "./network";

function makeThreeStations(net: Network) {
  const a = net.addStation(116.38, 39.9);
  const b = net.addStation(116.4, 39.91);
  const c = net.addStation(116.42, 39.92);
  return [a, b, c] as const;
}

describe("Network 车站", () => {
  it("建站分配唯一 id 与自动站名", () => {
    const net = new Network();
    const a = net.addStation(116.38, 39.9);
    const b = net.addStation(116.4, 39.91);
    expect(a.id).not.toBe(b.id);
    expect(a.name).toBe("车站1");
    expect(b.name).toBe("车站2");
    expect(net.stations).toHaveLength(2);
  });

  it("改名生效", () => {
    const net = new Network();
    const a = net.addStation(116.38, 39.9);
    net.renameStation(a.id, "西直门");
    expect(net.getStation(a.id)?.name).toBe("西直门");
  });

  it("删站会同时从所有线路的站序中移除", () => {
    const net = new Network();
    const [a, b, c] = makeThreeStations(net);
    const l1 = net.addLine();
    const l2 = net.addLine();
    for (const s of [a, b, c]) net.appendStationToLine(l1.id, s.id);
    for (const s of [b, c]) net.appendStationToLine(l2.id, s.id);
    net.deleteStation(b.id);
    expect(net.getStation(b.id)).toBeUndefined();
    expect(net.getLine(l1.id)?.stationIds).toEqual([a.id, c.id]);
    expect(net.getLine(l2.id)?.stationIds).toEqual([c.id]);
  });
});

describe("Network 线路", () => {
  it("新建线路带默认名、调色板颜色和默认服务计划", () => {
    const net = new Network();
    const l1 = net.addLine();
    const l2 = net.addLine();
    expect(l1.name).toBe("1号线");
    expect(l2.name).toBe("2号线");
    expect(l1.color).not.toBe(l2.color);
    expect(l1.servicePlan.headwayByHour).toHaveLength(24);
    expect(l1.servicePlan.firstTrainMin).toBeLessThan(l1.servicePlan.lastTrainMin);
  });

  it("按顺序并线,拒绝连续重复同一站", () => {
    const net = new Network();
    const [a, b] = makeThreeStations(net);
    const l = net.addLine();
    expect(net.appendStationToLine(l.id, a.id)).toBe(true);
    expect(net.appendStationToLine(l.id, a.id)).toBe(false);
    expect(net.appendStationToLine(l.id, b.id)).toBe(true);
    expect(net.getLine(l.id)?.stationIds).toEqual([a.id, b.id]);
  });

  it("线路改名生效", () => {
    const net = new Network();
    const l = net.addLine();
    net.renameLine(l.id, "亦庄线");
    expect(net.getLine(l.id)?.name).toBe("亦庄线");
  });

  it("反向延长:prepend 接到首端,拒绝相邻重复", () => {
    const net = new Network();
    const [a, b, c] = makeThreeStations(net);
    const l = net.addLine();
    net.appendStationToLine(l.id, b.id);
    net.appendStationToLine(l.id, c.id);
    expect(net.prependStationToLine(l.id, a.id)).toBe(true);
    expect(net.getLine(l.id)?.stationIds).toEqual([a.id, b.id, c.id]);
    expect(net.prependStationToLine(l.id, a.id)).toBe(false); // 已是首站
  });

  it("中插:insertStationInLine 在指定位置插入,拒绝相邻重复", () => {
    const net = new Network();
    const [a, b, c] = makeThreeStations(net);
    const l = net.addLine();
    net.appendStationToLine(l.id, a.id);
    net.appendStationToLine(l.id, c.id);
    expect(net.insertStationInLine(l.id, b.id, 1)).toBe(true);
    expect(net.getLine(l.id)?.stationIds).toEqual([a.id, b.id, c.id]);
    // index 钳制;插到已有相邻站被拒
    expect(net.insertStationInLine(l.id, b.id, 1)).toBe(false);
    expect(net.insertStationInLine(l.id, b.id, 2)).toBe(false);
  });

  it("删线保留车站", () => {
    const net = new Network();
    const [a] = makeThreeStations(net);
    const l = net.addLine();
    net.appendStationToLine(l.id, a.id);
    net.deleteLine(l.id);
    expect(net.lines).toHaveLength(0);
    expect(net.getStation(a.id)).toBeDefined();
  });

  it("经停多线的站被识别为换乘站", () => {
    const net = new Network();
    const [a, b] = makeThreeStations(net);
    const l1 = net.addLine();
    const l2 = net.addLine();
    net.appendStationToLine(l1.id, a.id);
    net.appendStationToLine(l1.id, b.id);
    net.appendStationToLine(l2.id, b.id);
    expect(net.linesThroughStation(a.id)).toHaveLength(1);
    expect(net.linesThroughStation(b.id)).toHaveLength(2);
  });
});

describe("Network 服务计划", () => {
  it("部分更新生效并触发订阅", () => {
    const net = new Network();
    const l = net.addLine();
    let calls = 0;
    net.subscribe(() => calls++);
    net.updateServicePlan(l.id, { stock: { type: "A", cars: 8 } });
    const plan = net.getLine(l.id)!.servicePlan;
    expect(plan.stock).toEqual({ type: "A", cars: 8 });
    expect(plan.firstTrainMin).toBe(330); // 未动的字段保持
    expect(calls).toBe(1);
  });

  it("非法值被钳制:间隔、编组、首末班车次序", () => {
    const net = new Network();
    const l = net.addLine();
    net.updateServicePlan(l.id, {
      headwayByHour: new Array(24).fill(0.5),
      stock: { type: "C", cars: 99 },
      firstTrainMin: 1430,
      lastTrainMin: 100,
    });
    const plan = net.getLine(l.id)!.servicePlan;
    expect(plan.headwayByHour.every((h) => h >= 2)).toBe(true);
    expect(plan.stock.cars).toBe(10);
    expect(plan.lastTrainMin - plan.firstTrainMin).toBeGreaterThanOrEqual(60);
    expect(plan.lastTrainMin).toBeLessThanOrEqual(1439);
  });
});

describe("Network 序列化", () => {
  it("toJSON/fromJSON 往返保持全部数据", () => {
    const net = new Network();
    const [a, b] = makeThreeStations(net);
    const l = net.addLine("环线", "#123456");
    net.appendStationToLine(l.id, a.id);
    net.appendStationToLine(l.id, b.id);
    net.renameStation(a.id, "复兴门");

    const restored = Network.fromJSON(net.toJSON());
    expect(restored.toJSON()).toEqual(net.toJSON());
    expect(restored.getStation(a.id)?.name).toBe("复兴门");
  });

  it("读档后新建的 id 不与旧 id 冲突", () => {
    const net = new Network();
    makeThreeStations(net);
    net.addLine();
    const restored = Network.fromJSON(net.toJSON());
    const oldStationIds = new Set(restored.stations.map((s) => s.id));
    const oldLineIds = new Set(restored.lines.map((l) => l.id));
    const s = restored.addStation(116.5, 39.95);
    const l = restored.addLine();
    expect(oldStationIds.has(s.id)).toBe(false);
    expect(oldLineIds.has(l.id)).toBe(false);
  });

  it("变更时触发订阅回调,退订后不再触发", () => {
    const net = new Network();
    let calls = 0;
    const unsubscribe = net.subscribe(() => calls++);
    const a = net.addStation(116.38, 39.9);
    net.addLine();
    expect(calls).toBe(2);
    unsubscribe();
    net.deleteStation(a.id);
    expect(calls).toBe(2);
  });
});
