import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildGridInit } from "./columnTypeMapping";

const NUM_RUNS = 200;

const NUMERIC_TYPES = ["Integer", "Number"];

const columnType = fc.constantFrom(
  "Text",
  "Integer",
  "BigInteger",
  "Number",
  "unrecognized",
  null,
  undefined,
);

const cellValue = fc.oneof(
  fc.string(),
  fc.double({ noNaN: true }),
  fc.integer(),
  fc.boolean(),
  fc.bigInt(),
  fc.constant(null),
  fc.constant(undefined),
  fc.dictionary(fc.string({ maxLength: 4 }), fc.integer(), { maxKeys: 2 }),
  fc.array(fc.integer(), { maxLength: 3 }),
);

const table = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
    minLength: 1,
    maxLength: 6,
  })
  .filter((names) => names.every((n) => n !== "__proto__"))
  .chain((names) =>
    fc.record({
      names: fc.constant(names),
      types: fc.array(columnType, {
        minLength: names.length,
        maxLength: names.length,
      }),
      rows: fc.array(
        fc
          .tuple(...names.map(() => cellValue))
          .map((cells) =>
            Object.fromEntries(names.map((n, i) => [n, cells[i]])),
          ),
        { maxLength: 5 },
      ),
    }),
  );

describe("buildGridInit properties", () => {
  it("keys the schema by every column name", () => {
    fc.assert(
      fc.property(table, ({ names, types, rows }) => {
        const { schema } = buildGridInit(names, types, rows);
        expect(Object.keys(schema).sort()).toEqual([...names].sort());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("reports the result's column order exactly, whatever the names", () => {
    fc.assert(
      fc.property(table, ({ names, types, rows }) => {
        const { columns } = buildGridInit(names, types, rows);
        expect(columns).toEqual(names);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("renders values of an unknown or absent type as text or null", () => {
    fc.assert(
      fc.property(table, ({ names, types, rows }) => {
        const init = buildGridInit(names, types, rows);
        names.forEach((name, i) => {
          if (types[i] === "unrecognized" || types[i] == null) {
            for (const row of init.rows) {
              expect(row[name] === null || typeof row[name] === "string").toBe(
                true,
              );
            }
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("passes values of a numeric type through unchanged", () => {
    fc.assert(
      fc.property(table, ({ names, types, rows }) => {
        const init = buildGridInit(names, types, rows);
        names.forEach((name, i) => {
          if (NUMERIC_TYPES.includes(types[i] as string)) {
            init.rows.forEach((row, r) => {
              expect(row[name]).toBe(rows[r][name] ?? null);
            });
          }
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
