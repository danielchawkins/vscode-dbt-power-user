import { describe, expect, it } from "@jest/globals";
import { failClosedIntegrationFactory } from "../../inversify/failClosedIntegrationFactory";

describe("failClosedIntegrationFactory", () => {
  it("rejects unsupported integration construction", () => {
    expect(() =>
      failClosedIntegrationFactory("/tmp/project", [], undefined, () => {}),
    ).toThrow("Only dbt Fusion is supported");
  });
});
