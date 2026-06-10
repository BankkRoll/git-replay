import { describe, it, expect } from "vitest";
import { mapPool, values } from "../src/lib/pool.js";

describe("mapPool", () => {
  it("maps every item and preserves order", async () => {
    const out = await mapPool([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(values(out)).toEqual([10, 20, 30, 40]);
  });

  it("captures per-item failures without rejecting the batch", async () => {
    const out = await mapPool([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(out[0]).toEqual({ ok: true, value: 1 });
    expect(out[1]?.ok).toBe(false);
    expect(out[2]).toEqual({ ok: true, value: 3 });
    expect(values(out)).toEqual([1, 3]);
  });

  it("never runs more than `concurrency` tasks at once", async () => {
    let active = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("handles an empty input", async () => {
    expect(await mapPool([], 4, async (n) => n)).toEqual([]);
  });
});
