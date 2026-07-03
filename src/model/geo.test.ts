import { describe, expect, it } from "vitest";
import { haversineKm } from "./geo";

describe("haversineKm", () => {
  it("同一点距离为 0", () => {
    const p = { lng: 116.4, lat: 39.9 };
    expect(haversineKm(p, p)).toBe(0);
  });

  it("赤道上经度 1 度约 111.2 公里", () => {
    const d = haversineKm({ lng: 0, lat: 0 }, { lng: 1, lat: 0 });
    expect(d).toBeGreaterThan(111);
    expect(d).toBeLessThan(111.5);
  });

  it("北京纬度上经度差按 cos(lat) 收缩", () => {
    const d = haversineKm({ lng: 116, lat: 39.9 }, { lng: 117, lat: 39.9 });
    const expected = 111.2 * Math.cos((39.9 * Math.PI) / 180);
    expect(Math.abs(d - expected)).toBeLessThan(0.5);
  });
});
