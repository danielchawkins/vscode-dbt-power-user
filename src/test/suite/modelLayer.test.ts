import { describe, expect, it } from "vitest";
import { inferLayer } from "../../core/manifest/modelLayer";

const on = { tagPrefix: "layer/", fromPath: true };

describe("inferLayer", () => {
  it("prefers a tag with the configured prefix over the folder and name", () => {
    expect(
      inferLayer(
        {
          tags: ["pii", "layer/semantic"],
          path: "models/staging/stg_orders.sql",
          name: "stg_orders",
        },
        on,
      ),
    ).toBe("semantic");
  });

  it("reads the nearest layer folder, then the name prefix", () => {
    expect(
      inferLayer({ path: "models/marts/finance/stg_x.sql", name: "stg_x" }, on),
    ).toBe("marts");
    expect(
      inferLayer({ path: "models/21_intermediate/grant/x.sql", name: "x" }, on),
    ).toBe("intermediate");
    expect(inferLayer({ path: "models/13_staging/a.sql", name: "a" }, on)).toBe(
      "staging",
    );
    expect(
      inferLayer(
        { path: "models/x/dim_customer.sql", name: "dim_customer" },
        on,
      ),
    ).toBe("marts");
    expect(inferLayer({ path: "models\\staging\\a.sql", name: "a" }, on)).toBe(
      "staging",
    );
  });

  it("is undefined when nothing applies, or when path inference is off", () => {
    expect(inferLayer({ path: "models/a.sql", name: "orders" }, on)).toBe(
      undefined,
    );
    expect(
      inferLayer(
        { path: "models/staging/stg_a.sql", name: "stg_a" },
        { tagPrefix: "layer/", fromPath: false },
      ),
    ).toBe(undefined);
  });

  it("ignores tags when the prefix is empty, and a bare prefix tag", () => {
    expect(
      inferLayer(
        { tags: ["staging"], name: "orders" },
        { tagPrefix: "", fromPath: true },
      ),
    ).toBe(undefined);
    expect(inferLayer({ tags: ["layer/"], name: "fct_a" }, on)).toBe("marts");
  });
});
