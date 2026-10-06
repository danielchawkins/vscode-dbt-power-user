import { describe, expect, it } from "vitest";
import { countProductionErrors } from "../../../../scripts/quality/strict-ts.mjs";

describe("countProductionErrors", () => {
  it("counts errors in production files and skips tests, test helpers and continuation lines", () => {
    const output = [
      "src/a.ts(1,2): error TS2532: Object is possibly 'undefined'.",
      "  Type 'undefined' is not assignable to type 'string'.",
      "src/modules/tests/Form.tsx(3,4): error TS2345: Argument.",
      "src/b.test.ts(5,6): error TS2532: Object is possibly 'undefined'.",
      "src/test/mock/vscode.ts(7,8): error TS2532: Object is possibly 'undefined'.",
      "src/c.property.test.tsx(9,1): error TS2532: Object is possibly 'undefined'.",
    ].join("\n");

    expect(countProductionErrors(output)).toBe(2);
  });
});
