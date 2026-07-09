import { describe, expect, it } from "vitest";
import { Network } from "../../model/network";
import type { NetworkData } from "../../model/types";
import { computeScore, type ScoreInput } from "./scoring";

/** n 站单线网络 */
function lineNet(n: number): NetworkData {
  const net = new Network();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(net.addStation(116.3 + i * 0.01, 39.9).id);
  const l = net.addLine();
  for (const id of ids) net.appendStationToLine(l.id, id);
  return net.toJSON();
}

function input(served: number, unserved = 0): ScoreInput {
  return {
    servedTrips: served,
    metroDemandTrips: served + unserved,
    unservedTrips: unserved,
    loadFactors: [],
  };
}

describe("computeScore", () => {
  it("绝对客流小的 4 站线不会刷到 A+(效率乘子有界)", () => {
    // 每站客流极高(20万/8),但绝对规模只有 19 万 → 不该 A+
    const s = computeScore(lineNet(4), input(192_000));
    expect(s.rating).toBeLessThan(60); // F 档
  });

  it("绝对客流越大评分越高(主项单调)", () => {
    const net = lineNet(20);
    const low = computeScore(net, input(1_000_000));
    const high = computeScore(net, input(4_000_000));
    expect(high.rating).toBeGreaterThan(low.rating);
  });

  it("未送达比例升高 → 服务质量与评分下降", () => {
    const net = lineNet(20);
    const good = computeScore(net, input(2_000_000, 0));
    const bad = computeScore(net, input(2_000_000, 2_000_000)); // 一半未送达
    expect(bad.serviceQuality).toBeLessThan(good.serviceQuality);
    expect(bad.rating).toBeLessThan(good.rating);
  });

  it("拥挤(满载率>1)降低服务质量", () => {
    const net = lineNet(10);
    const base = computeScore(net, { ...input(1_000_000), loadFactors: [new Float32Array([1, 1])] });
    const crowded = computeScore(net, {
      ...input(1_000_000),
      loadFactors: [new Float32Array([2.5, 2.0])],
    });
    expect(crowded.serviceQuality).toBeLessThan(base.serviceQuality);
  });

  it("同样客流:紧凑高效网络评分高于稀疏低效网络,但效率乘子有界", () => {
    // 都服务 200 万:4 站(每站 25 万,效率撞上限)vs 200 站(每站 5000,未撞限)
    const compact = computeScore(lineNet(4), input(2_000_000));
    const sprawling = computeScore(lineNet(200), input(2_000_000));
    expect(compact.rating).toBeGreaterThan(sprawling.rating);
    // 效率有界:紧凑网评分不超过 σ×ln(3)×CAP(≈120.7),不会无限刷高
    expect(compact.rating).toBeLessThan(61 * Math.log(3) * 1.8 + 1);
  });

  it("空网络评分为 F", () => {
    expect(computeScore({ version: 1, stations: [], lines: [] }, input(0)).grade).toBe("F");
  });
});
