import { describe, expect, it } from "vitest";

import { disposeAll } from "../../core/disposables";

describe("disposeAll", () => {
  it("disposes last-registered first and empties the list", () => {
    const order: string[] = [];
    const items = ["a", "b", "c"].map((name) => ({
      dispose: () => order.push(name),
    }));
    disposeAll(items);
    expect(order).toEqual(["c", "b", "a"]);
    expect(items).toEqual([]);
  });

  it("skips an undefined entry", () => {
    let count = 0;
    disposeAll([undefined, { dispose: () => count++ }]);
    expect(count).toBe(1);
  });

  it("disposes nothing on a second call", () => {
    let count = 0;
    const items = [{ dispose: () => count++ }];
    disposeAll(items);
    disposeAll(items);
    expect(count).toBe(1);
  });
});
