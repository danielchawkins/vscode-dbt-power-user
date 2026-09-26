import { describe, expect, it } from "@jest/globals";
import { parse } from "yaml";
import { planProjectConfigInsertion } from "../../fusion/projectConfigEdits";
import { SCHEMA_ORIGIN_HOOK } from "../../fusion/schemaOrigin";

const strict = {
  path: ["models", "jaffle", "+static_analysis"],
  value: "strict",
} as const;
const hook = { path: ["sources", "+schema_origin"], value: SCHEMA_ORIGIN_HOOK };

describe("planProjectConfigInsertion", () => {
  it("adds the strict opt-in and keeps comments and existing keys", () => {
    const yaml =
      "# project\nname: jaffle\nmodels:\n  jaffle:\n    staging:\n      +materialized: view # inline\n";
    const plan = planProjectConfigInsertion(yaml, strict);

    expect(plan.kind).toBe("insert");
    if (plan.kind !== "insert") {
      return;
    }
    expect(plan.text).toContain("# project");
    expect(plan.text).toContain("# inline");
    expect(parse(plan.text)).toEqual({
      name: "jaffle",
      models: {
        jaffle: {
          staging: { "+materialized": "view" },
          "+static_analysis": "strict",
        },
      },
    });
    expect(plan.preview).toBe(
      "models:\n  jaffle:\n    +static_analysis: strict",
    );
  });

  it("adds the schema-origin hook as a quoted string", () => {
    const plan = planProjectConfigInsertion("name: jaffle\n", hook);

    expect(plan.kind).toBe("insert");
    if (plan.kind !== "insert") {
      return;
    }
    expect(parse(plan.text).sources["+schema_origin"]).toBe(SCHEMA_ORIGIN_HOOK);
    expect(plan.preview).toBe(
      `sources:\n  +schema_origin: ${JSON.stringify(SCHEMA_ORIGIN_HOOK)}`,
    );
  });

  it.each([
    ["the same value", "strict"],
    ["a different value", "baseline"],
  ])("never overwrites %s", (_, existing) => {
    const yaml = `name: jaffle\nmodels:\n  jaffle:\n    +static_analysis: ${existing}\n`;
    expect(planProjectConfigInsertion(yaml, strict)).toEqual({
      kind: "exists",
      current: existing,
    });
  });

  it("throws when dbt_project.yml does not parse", () => {
    expect(() =>
      planProjectConfigInsertion("name: [unclosed\n", strict),
    ).toThrow(/does not parse/);
  });
});
