import { describe, expect, it } from "vitest";
import { graphUnavailable } from "../../projects/graphAvailability";

describe("graphUnavailable", () => {
  it("is undefined when the manifest carries a server value, whatever the client state", () => {
    expect(graphUnavailable("running", true)).toBeUndefined();
    expect(graphUnavailable("stopped", true)).toBeUndefined();
  });

  it("names the client state when there is no server value and it is not running", () => {
    expect(graphUnavailable("starting", false)).toContain("starting");
    expect(graphUnavailable("failed", false)).toContain("failed");
  });

  it("asks for the first compile when the client runs and there is no server value yet", () => {
    const notice = graphUnavailable("running", false);
    expect(notice).toContain("first compile");
    expect(notice).not.toContain("strict");
  });
});
