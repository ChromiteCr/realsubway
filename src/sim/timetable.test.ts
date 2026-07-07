import { describe, expect, it } from "vitest";
import { Network } from "../model/network";
import { buildLineTimetable, trainPositionsAt } from "./timetable";

function makeLine() {
  const net = new Network();
  const a = net.addStation(116.38, 39.9);
  const b = net.addStation(116.4, 39.9); // ~1.71km
  const c = net.addStation(116.42, 39.9);
  const l = net.addLine();
  for (const s of [a, b, c]) net.appendStationToLine(l.id, s.id);
  return { net, l };
}

describe("buildLineTimetable", () => {
  it("发车间隔跟随各小时设置,首末班之外无发车", () => {
    const { net, l } = makeLine();
    net.updateServicePlan(l.id, {
      firstTrainMin: 360, // 06:00
      lastTrainMin: 480, // 08:00
      headwayByHour: new Array(24).fill(10),
    });
    const tt = buildLineTimetable(net.getLine(l.id)!, new Map(net.stations.map((s) => [s.id, s])))!;
    const deps = tt.directions[0].departures;
    expect(deps[0]).toBe(360);
    expect(deps[deps.length - 1]).toBeLessThanOrEqual(480);
    expect(deps.length).toBe(13); // 06:00..08:00 每 10 分钟
  });

  it("单站线返回 null", () => {
    const net = new Network();
    const a = net.addStation(116.38, 39.9);
    const l = net.addLine();
    net.appendStationToLine(l.id, a.id);
    const tt = buildLineTimetable(net.getLine(l.id)!, new Map(net.stations.map((s) => [s.id, s])));
    expect(tt).toBeNull();
  });
});

describe("trainPositionsAt", () => {
  it("发车前无车,发车瞬间在首站,行程中间在线上,到达后消失", () => {
    const { net, l } = makeLine();
    net.updateServicePlan(l.id, {
      firstTrainMin: 360,
      lastTrainMin: 361, // 只发一班
      headwayByHour: new Array(24).fill(30),
    });
    const tt = buildLineTimetable(net.getLine(l.id)!, new Map(net.stations.map((s) => [s.id, s])))!;
    const dir = tt.directions[0];
    const dur = dir.tripDurationMin;
    expect(dur).toBeGreaterThan(3);

    const at = (t: number) => {
      const out: number[] = [];
      trainPositionsAt(dir, t, out);
      return out;
    };
    expect(at(359)).toHaveLength(0);
    const atStart = at(360);
    expect(atStart).toHaveLength(2);
    expect(atStart[0]).toBeCloseTo(116.38, 6);
    const mid = at(360 + dur / 2);
    expect(mid).toHaveLength(2);
    expect(mid[0]!).toBeGreaterThan(116.38);
    expect(mid[0]!).toBeLessThan(116.42);
    expect(at(360 + dur + 0.01)).toHaveLength(0);
  });

  it("双向发车:同一时刻两方向各有在途列车,坐标互为镜像行进", () => {
    const { net, l } = makeLine();
    net.updateServicePlan(l.id, {
      firstTrainMin: 360,
      lastTrainMin: 1380,
      headwayByHour: new Array(24).fill(5),
    });
    const tt = buildLineTimetable(net.getLine(l.id)!, new Map(net.stations.map((s) => [s.id, s])))!;
    const outFw: number[] = [];
    const outBw: number[] = [];
    trainPositionsAt(tt.directions[0], 400, outFw);
    trainPositionsAt(tt.directions[1], 400, outBw);
    expect(outFw.length).toBeGreaterThan(0);
    expect(outBw.length).toBe(outFw.length);
  });
});
