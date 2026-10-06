import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  countSql,
  fusionCteFromLens,
  previewSql,
} from "../../core/cte/ctePreview";
import { NUM_RUNS } from "../arbitraries";

const cte = {
  name: "final",
  compiledPath: "/p/target/.lsp/compiled/x.sql",
  compiledStart: 0,
  compiledStop: 0,
  line: 3,
};
const bytes = (text: string) => Buffer.byteLength(text);

describe("ctePreview", () => {
  it("slices by UTF-8 byte offsets", () => {
    const prefix = "-- é日本\n";
    const body = "with a as (select 'ü' as x";
    const compiled = `${prefix}${body})\nselect 1`;
    const target = {
      ...cte,
      name: "a",
      compiledStart: bytes(prefix),
      compiledStop: bytes(prefix + body),
    };
    expect(previewSql(compiled, target)).toBe(`${body}\n)\nselect * from a`);
  });

  it("keeps the body of any generated CTE whatever the surrounding non-ASCII text", () => {
    const text = fc.string({ unit: "binary" });
    fc.assert(
      fc.property(text, text, text, (a, inner, b) => {
        const body = `with a as (${inner}`;
        const compiled = `${a}${body}${b}`;
        const target = {
          ...cte,
          name: "a",
          compiledStart: bytes(a),
          compiledStop: bytes(a + body),
        };
        expect(previewSql(compiled, target)).toBe(
          `${body}\n)\nselect * from a`,
        );
        expect(previewSql(Buffer.from(compiled), target)).toBe(
          `${body}\n)\nselect * from a`,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("generates text whose UTF-8 length differs from its UTF-16 length", () => {
    const samples = fc.sample(fc.string({ unit: "binary" }), 200);
    expect(
      samples.some((text) => Buffer.byteLength(text) !== text.length),
    ).toBe(true);
  });

  it("refuses a slice cut from a different version of the compiled file", () => {
    const compiled = "with a as (select 1), b as (select 2)";
    const target = {
      ...cte,
      name: "b",
      compiledStart: 0,
      compiledStop: bytes("with a as (select 1"),
    };
    const stale = /compiled file changed/;
    expect(() => previewSql(compiled, target)).toThrow(stale);
    expect(() => countSql(compiled, { ...target, compiledStart: 3 })).toThrow(
      stale,
    );
  });

  it("builds the preview and count queries", () => {
    const compiled = "with a as (select 1)";
    const target = {
      ...cte,
      name: "a",
      compiledStop: bytes("with a as (select 1"),
    };
    expect(previewSql(compiled, target)).toBe(
      "with a as (select 1\n)\nselect * from a",
    );
    expect(countSql(compiled, target)).toBe(
      "with a as (select 1\n)\nselect count(*) as _profile_count from a",
    );
    const spaced = 'with "my cte" as (select 1';
    expect(
      previewSql(`${spaced})`, {
        ...target,
        name: "my cte",
        compiledStop: bytes(spaced),
      }),
    ).toContain('from "my cte"');
  });

  it("reads a lens argument and rejects other shapes", () => {
    expect(
      fusionCteFromLens(
        {
          name: "a",
          compiled_path: "/x.sql",
          compiled_start: 2,
          compiled_stop: 9,
        },
        4,
      ),
    ).toEqual({
      name: "a",
      compiledPath: "/x.sql",
      compiledStart: 2,
      compiledStop: 9,
      line: 4,
    });
    expect(fusionCteFromLens({ name: "a" }, 0)).toBeUndefined();
    expect(fusionCteFromLens(null, 0)).toBeUndefined();
  });
});
