import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  containsRefCall,
  containsSourceCall,
  parseRefExpression,
} from "../../core/manifest/refExpression";
import { NUM_RUNS } from "../arbitraries";

const identifier = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,15}$/);
const quote = fc.constantFrom("'", '"');
const space = fc.constantFrom("", " ", "  ", "\t", "\n");
// Any name a quoted argument can hold: no quote characters, and not empty.
const quotable = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => !/['"]/.test(s));

describe("parseRefExpression properties", () => {
  it("reads a one-argument ref whatever the spacing and quote style", () => {
    fc.assert(
      fc.property(
        fc.tuple(identifier, quote, space, space, space),
        ([name, q, s1, s2, s3]) => {
          expect(
            parseRefExpression(`${s1}ref${s2}(${s2}${q}${name}${q}${s3})${s1}`),
          ).toEqual({ kind: "ref", name });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("reads the two-argument ref with the package first and the name second", () => {
    fc.assert(
      fc.property(
        fc.tuple(identifier, identifier, quote, quote, space),
        ([pkg, name, q1, q2, ws]) => {
          expect(
            parseRefExpression(
              `ref(${ws}${q1}${pkg}${q1}${ws},${ws}${q2}${name}${q2}${ws})`,
            ),
          ).toEqual({ kind: "ref", name, package: pkg });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("reads v= and version= as the version, quoted or bare, with or without a package", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          identifier,
          identifier,
          fc.integer({ min: 1, max: 99 }),
          fc.constantFrom("v", "version"),
          quote,
          fc.boolean(),
          space,
        ),
        ([name, pkg, version, keyword, q, withPackage, ws]) => {
          const packageArg = withPackage ? `${q}${pkg}${q},${ws}` : "";
          const expected = {
            kind: "ref",
            name,
            ...(withPackage ? { package: pkg } : {}),
            version: String(version),
          };
          expect(
            parseRefExpression(
              `ref(${packageArg}${q}${name}${q},${ws}${keyword}${ws}=${ws}${q}${version}${q})`,
            ),
          ).toEqual(expected);
          expect(
            parseRefExpression(
              `ref(${packageArg}${q}${name}${q},${ws}${keyword}=${version})`,
            ),
          ).toEqual(expected);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("round-trips any quotable name, including ones with spaces and punctuation", () => {
    fc.assert(
      fc.property(fc.tuple(quotable, quote), ([name, q]) => {
        expect(parseRefExpression(`ref(${q}${name}${q})`)).toEqual({
          kind: "ref",
          name,
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("reads a source with its source name first and its table second", () => {
    fc.assert(
      fc.property(
        fc.tuple(identifier, identifier, quote, quote, space),
        ([source, table, q1, q2, ws]) => {
          expect(
            parseRefExpression(
              `source${ws}(${ws}${q1}${source}${q1}${ws},${ws}${q2}${table}${q2}${ws})`,
            ),
          ).toEqual({ kind: "source", source, table });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("returns nothing for text that does not start with ref or source", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/^\s*(ref|source)/.test(s)),
        (text) => {
          expect(parseRefExpression(text)).toBeUndefined();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("never throws, and only ever returns a ref or a source", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const parsed = parseRefExpression(text);
        if (parsed !== undefined) {
          expect(["ref", "source"]).toContain(parsed.kind);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("body call matching properties", () => {
  it("finds a ref call whose name contains regex metacharacters", () => {
    fc.assert(
      fc.property(fc.tuple(quotable, quote), ([name, q]) => {
        expect(
          containsRefCall(`select * from ref(${q}${name}${q})`, name),
        ).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("finds a two-argument ref when its package and name match", () => {
    fc.assert(
      fc.property(fc.tuple(identifier, identifier), ([pkg, name]) => {
        // With pkg === name the one-argument pattern also matches, which is not what this asserts.
        fc.pre(pkg !== name);
        const body = `ref('${pkg}', '${name}')`;
        expect(containsRefCall(body, name, pkg)).toBe(true);
        expect(containsRefCall(body, name, `${pkg}x`)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("finds a source call by its source and table names", () => {
    fc.assert(
      fc.property(fc.tuple(identifier, identifier), ([source, table]) => {
        const body = `source('${source}', '${table}')`;
        expect(containsSourceCall(body, source, table)).toBe(true);
        expect(containsSourceCall(body, source, `${table}x`)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
