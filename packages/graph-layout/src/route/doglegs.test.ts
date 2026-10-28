import { describe, expect, it } from "vitest";
import { routeChannel } from "./channel.js";
import type { ChannelPiece } from "./channelTypes.js";

/** Pieces drawn from a fixed linear congruential sequence, so the sample is the same on every run. */
function randomBand(seed: number, count: number): ChannelPiece[] {
  let state = seed;
  const next = (n: number): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return Math.floor(state / 65536) % n;
  };
  return Array.from({ length: count }, () => ({
    from: next(40),
    to: next(40),
    flat: next(4) === 0,
    trunk: next(3) === 0 ? `port${next(3)}` : undefined,
  }));
}

describe("doglegs", () => {
  it("never raise a band's crossings, and lower them somewhere in a random sample", () => {
    let plain = 0;
    let doglegged = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const pieces = randomBand(seed, 24);
      const without = routeChannel(pieces, {
        edge: 4,
        budget: 1_000_000,
        doglegWork: 0,
      });
      const withDoglegs = routeChannel(pieces, {
        edge: 4,
        budget: 1_000_000,
        doglegWork: 10_000_000,
      });
      expect(withDoglegs.crossings).toBeLessThanOrEqual(without.crossings);
      plain += without.crossings;
      doglegged += withDoglegs.crossings;
    }
    expect(doglegged).toBeLessThan(plain);
  }, 60_000);
});
