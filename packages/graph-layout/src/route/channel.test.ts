import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { routeChannel } from "./channel.js";
import type { ChannelPiece } from "./channelTypes.js";

const EDGE = 4;
const budget = 1_000_000;

/** A run that leaves its upper end at `from` and enters its lower end at `to`. */
const down = (from: number, to: number): ChannelPiece => ({
  from,
  to,
  flat: false,
});

describe("routeChannel", () => {
  it("gives runs that overlap nothing one shared track", () => {
    const result = routeChannel([down(0, 10), down(20, 30)], {
      edge: EDGE,
      budget,
    });
    expect(result.track).toEqual([0, 0]);
    expect(result.trackCount).toBe(1);
    expect(result.crossings).toBe(0);
  });

  it("puts the run above the one it would otherwise cross", () => {
    // a runs 0 to 10 and b runs 5 to 15: with b above a, no run crosses another.
    const result = routeChannel([down(0, 10), down(5, 15)], {
      edge: EDGE,
      budget,
    });
    expect(result.trackCount).toBe(2);
    expect(result.track[1]).toBeLessThan(result.track[0] ?? -1);
    expect(result.crossings).toBe(0);
  });

  it("puts a run whose upper end meets another's lower end above it, with no overlap", () => {
    const pieces = [down(0, 10), down(10, 20)];
    const result = routeChannel(pieces, { edge: EDGE, budget });
    expect(result.pairs).toBe(1);
    expect(result.track[1]).toBeLessThan(result.track[0] ?? 0);
    expect(result.crossings).toBe(0);
  });

  it("counts a crossing between runs from one trunk as none, as measureDrawing does", () => {
    // a runs 0 to 30 and b runs 10 to 5: their order is forced, so they cross unless they share a trunk.
    const crossing = routeChannel([down(0, 30), down(10, 5)], {
      edge: EDGE,
      budget,
    });
    expect(crossing.crossings).toBe(1);
    const trunked = routeChannel(
      [
        { ...down(0, 30), trunk: "p" },
        { ...down(10, 5), trunk: "p" },
      ],
      { edge: EDGE, budget },
    );
    expect(trunked.crossings).toBe(0);
  });

  it("merges runs that leave the same point onto one track", () => {
    const result = routeChannel([down(5, 10), down(5, 20)], {
      edge: EDGE,
      budget,
    });
    expect(result.track[0]).toBe(result.track[1]);
    expect(result.trackCount).toBe(1);
  });

  it("merges runs that enter the same point, transitively", () => {
    const result = routeChannel([down(0, 10), down(5, 10), down(5, 30)], {
      edge: EDGE,
      budget,
    });
    expect(new Set(result.track).size).toBe(1);
  });

  it("gives a straight run no track, and counts it crossing the runs it passes", () => {
    const result = routeChannel([down(3, 3), down(0, 10)], {
      edge: EDGE,
      budget,
    });
    expect(result.track).toEqual([-1, 0]);
    expect(result.trackCount).toBe(1);
    expect(result.crossings).toBe(1);
  });

  it("counts a straight run crossing the track of a flat run beneath its rank", () => {
    const result = routeChannel([{ from: 0, to: 10, flat: true }, down(4, 4)], {
      edge: EDGE,
      budget,
    });
    expect(result.track[0]).toBe(0);
    expect(result.crossings).toBe(1);
  });

  it("stops at the pair budget and says so", () => {
    const pieces = [down(0, 10), down(1, 11), down(2, 12), down(3, 13)];
    const result = routeChannel(pieces, { edge: EDGE, budget: 2 });
    expect(result.pairs).toBe(2);
    expect(result.capped).toBe(true);
    expect(result.track.every((t) => t >= 0)).toBe(true);
  });

  it("is a pure function of its pieces", () => {
    const pieces = [down(0, 9), down(4, 2), down(7, 12), down(1, 1)];
    expect(routeChannel(pieces, { edge: EDGE, budget })).toEqual(
      routeChannel(pieces, { edge: EDGE, budget }),
    );
  });

  it("keeps runs on one track apart by the edge spacing when no two share an end", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 400 }), { maxLength: 50 }),
        (values) => {
          const pieces: ChannelPiece[] = [];
          for (let i = 0; i + 1 < values.length; i += 2) {
            pieces.push(down(values[i] ?? 0, values[i + 1] ?? 0));
          }
          const result = routeChannel(pieces, { edge: EDGE, budget });
          pieces.forEach((a, i) => {
            pieces.slice(i + 1).forEach((b, k) => {
              const ta = result.track[i];
              if (
                ta !== undefined &&
                ta >= 0 &&
                ta === result.track[i + k + 1]
              ) {
                const gap = Math.max(
                  Math.min(a.from, a.to) - Math.max(b.from, b.to),
                  Math.min(b.from, b.to) - Math.max(a.from, a.to),
                );
                expect(gap).toBeGreaterThanOrEqual(EDGE);
              }
            });
          });
        },
      ),
    );
  });
});
