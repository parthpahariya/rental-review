import { describe, expect, it } from "vitest";
import { formatShort, formatShortAtLeast } from "./format";

describe("formatShortAtLeast", () => {
  it("rounds a partial count down to a round number with +", () => {
    expect(formatShortAtLeast(7)).toBe("7+");
    expect(formatShortAtLeast(17)).toBe("10+");
    expect(formatShortAtLeast(53)).toBe("50+");
    expect(formatShortAtLeast(99)).toBe("90+");
    expect(formatShortAtLeast(100)).toBe("100+");
    expect(formatShortAtLeast(373)).toBe("300+");
    expect(formatShortAtLeast(1_234)).toBe("1.2k+");
    expect(formatShortAtLeast(2_50_000)).toBe("2.5L+");
  });

  it("never claims more than the count", () => {
    for (const n of [1, 9, 10, 11, 99, 101, 999, 1_000, 1_999, 99_999]) {
      const shown = formatShortAtLeast(n).replace("+", "");
      const value = shown.endsWith("k")
        ? Number(shown.slice(0, -1)) * 1000
        : shown.endsWith("L")
          ? Number(shown.slice(0, -1)) * 1e5
          : Number(shown);
      expect(value).toBeLessThanOrEqual(n);
    }
  });

  it("leaves exact counts to formatShort", () => {
    expect(formatShort(373)).toBe("373");
  });
});
