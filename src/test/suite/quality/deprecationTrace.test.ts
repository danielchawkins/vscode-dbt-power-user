import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED,
  attribute,
  main,
  parseDeprecations,
} from "../../../../scripts/quality/deprecation-trace.mjs";

// Captured with --trace-deprecation from a Vitest 5.0.3 worker on Node 24.21.0. Only the first frames are kept.
// Paths use a neutral project root; the segments after it are kept as they are, since attribute() reads node_modules/.
const captured = [
  "(node:9011) [DEP0005] DeprecationWarning: Buffer() is deprecated due to security and usability issues. " +
    "Please use the Buffer.alloc(), Buffer.allocUnsafe(), or Buffer.from() methods instead.",
  "    at showFlaggedDeprecation (node:buffer:224:11)",
  "    at new Buffer (node:buffer:307:3)",
  "    at /home/user/project/src/test/suite/quality/probe.test.ts:5:10",
  "    at file:///home/user/project/node_modules/vitest/dist/chunks/run.BTlFXlnv.js:1628:35",
].join("\n");

const dep0169From = (frame: string) =>
  [
    "(node:4242) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized",
    "    at Object.urlParse [as parse] (node:url:136:13)",
    `    at ${frame}`,
  ].join("\n");

const allowed = (code: string, stack: string) =>
  (ALLOWED as Record<string, { packages: string[] }>)[code]?.packages.includes(
    attribute(stack),
  ) ?? false;

describe("parseDeprecations", () => {
  it("reads a captured --trace-deprecation block", () => {
    const [entry] = parseDeprecations(captured);
    expect(entry.code).toBe("DEP0005");
    expect(entry.message).toMatch(/^DeprecationWarning: Buffer\(\) is/);
    expect(entry.stack.split("\n")).toHaveLength(4);
  });

  it("ignores lines that are neither a warning header nor a stack frame", () => {
    const text = `${captured}\n✓ src/test/suite/quality/scratch.test.ts (1 test)\n    at ignored.js:1:1`;
    expect(parseDeprecations(text)).toHaveLength(1);
  });

  it("returns nothing for output without warnings", () => {
    expect(parseDeprecations("all good\n")).toEqual([]);
  });
});

describe("attribute", () => {
  it("names an unscoped package", () => {
    const stack =
      "    at Object.<anonymous> (/x/node_modules/left-pad/index.js:1:1)";
    expect(attribute(stack)).toBe("left-pad");
  });

  it("names a scoped package", () => {
    const stack =
      "    at Object.<anonymous> (/x/node_modules/@vscode/vsce/out/main.js:1:1)";
    expect(attribute(stack)).toBe("@vscode/vsce");
  });

  it("names the innermost package of a nested install", () => {
    const stack =
      "    at f (/x/node_modules/@vscode/vsce/node_modules/typed-rest-client/a.js:1:1)";
    expect(attribute(stack)).toBe("typed-rest-client");
  });

  it("returns (repository) when the caller is repository code", () => {
    const [entry] = parseDeprecations(captured);
    expect(attribute(entry.stack)).toBe("(repository)");
  });
});

describe("ALLOWED", () => {
  // Node 24 emits DEP0169 only for code outside node_modules, so these blocks are constructed to exercise the rule.
  it("passes DEP0169 from typed-rest-client", () => {
    const frame =
      "Object.<anonymous> (/x/node_modules/@vscode/vsce/node_modules/typed-rest-client/HttpClient.js:10:5)";
    expect(allowed("DEP0169", dep0169From(frame))).toBe(true);
  });

  it("fails DEP0169 from another package", () => {
    const frame = "Object.<anonymous> (/x/node_modules/left-pad/index.js:1:1)";
    expect(allowed("DEP0169", dep0169From(frame))).toBe(false);
  });

  it("fails any other code, even from an allowed package", () => {
    const frame =
      "Object.<anonymous> (/x/node_modules/typed-rest-client/a.js:1:1)";
    const stack = `    at showFlaggedDeprecation (node:buffer:224:11)\n    at ${frame}`;
    expect(allowed("DEP0005", stack)).toBe(false);
  });
});

describe("main", () => {
  it("fails a step that cannot be spawned, with its reason", () => {
    const spawnFails = () => ({
      error: Object.assign(new Error("spawnSync npm ENOENT"), {
        code: "ENOENT",
      }),
      status: null,
      stdout: null,
      stderr: null,
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCode = main(spawnFails);
    expect(exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "npm run compile failed to start: spawnSync npm ENOENT",
    );
    error.mockRestore();
  });
});
