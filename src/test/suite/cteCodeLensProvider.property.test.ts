import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Position, TextDocument } from "vscode";
import type { Log } from "../../core/log";
import {
  CteCodeLensProvider,
  CteInfo,
} from "../../features/cte/cteCodeLensProvider";
import { NUM_RUNS, sqlGap, sqlIdentifier } from "../arbitraries";

const terminal = {
  debug: () => {},
  warn: () => {},
  error: () => {},
  info: () => {},
  log: () => {},
  trace: () => {},
} as unknown as Log;
const provider = new CteCodeLensProvider(terminal);

const documentOf = (text: string): TextDocument =>
  ({
    getText: () => text,
    positionAt: (offset: number) => {
      const before = text.slice(0, offset).split("\n");
      return new Position(before.length - 1, before[before.length - 1].length);
    },
  }) as unknown as TextDocument;

const detectCtes = (text: string): CteInfo[] =>
  (
    provider as unknown as { detectCtes(d: TextDocument): CteInfo[] }
  ).detectCtes(documentOf(text));

/** One CTE: `name [(cols)] <gap> as (select <n> as x)`; `label` is the name the detector reports. */
const cte = fc
  .record({
    name: sqlIdentifier,
    columns: fc.option(
      fc.array(sqlIdentifier, { minLength: 1, maxLength: 3 }),
      { nil: undefined },
    ),
    columnSpace: fc.constantFrom("", " "),
    beforeAs: sqlGap,
    afterAs: fc.constantFrom("", " ", "\n"),
    value: fc.nat(999),
  })
  .map(({ name, columns, columnSpace, beforeAs, afterAs, value }) => {
    const label = columns
      ? `${name}${columnSpace}(${columns.join(", ")})`
      : name;
    return {
      label,
      sql: `${label} ${beforeAs}as${afterAs}(select ${value} as x)`,
    };
  });

describe("CteCodeLensProvider.detectCtes properties", () => {
  it("finds every CTE of a with clause, by name and in order", () => {
    fc.assert(
      fc.property(
        fc.array(cte, { minLength: 1, maxLength: 8 }),
        fc.array(fc.tuple(sqlGap, sqlGap), { minLength: 8, maxLength: 8 }),
        sqlGap,
        (ctes, gaps, tail) => {
          const body = ctes
            .map((c, i) => `${gaps[i][0]}${c.sql}${gaps[i][1]}`)
            .join(",");
          const sql = `with ${body}\n${tail}select * from x`;
          const found = detectCtes(sql);
          expect(found.map((c) => c.name)).toEqual(ctes.map((c) => c.label));
          expect(found.map((c) => c.index)).toEqual(ctes.map((_, i) => i));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("finds no CTE in text without a with keyword", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            sqlIdentifier,
            sqlGap,
            fc.constantFrom("(", ")", ",", " as "),
          ),
          {
            maxLength: 30,
          },
        ),
        (parts) => {
          const sql = parts.join(" ");
          fc.pre(!/with/i.test(sql));
          expect(detectCtes(sql)).toHaveLength(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
