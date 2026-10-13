import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DBT_SPY_LOG_ENV,
  dbtInvocations,
  dbtInvocationsSince,
  parseSpyLine,
  waitForDbtExits,
  waitForDbtQuiet,
} from "../integration/helpers/dbtSpy";

describe("dbtSpy log format", () => {
  describe("parseSpyLine", () => {
    it("reads a start line as its id and subcommand", () => {
      expect(
        parseSpyLine("1700000000000 start 42-1700000000000 parse"),
      ).toEqual({
        kind: "start",
        invocation: { id: "42-1700000000000", subcommand: "parse" },
      });
    });

    it("reads an exit line as the id it closes", () => {
      expect(parseSpyLine("1700000000900 exit 42-1700000000000 0")).toEqual({
        kind: "exit",
        id: "42-1700000000000",
      });
    });

    it("ignores a continuation line of an argument that was not flattened", () => {
      // `show --inline` with a multi-line document, as the old `"$*"` log would have written it.
      expect(parseSpyLine(" select 1")).toBeUndefined();
      expect(parseSpyLine(")")).toBeUndefined();
      expect(parseSpyLine("* from a --limit 500")).toBeUndefined();
    });
  });

  describe("with a spy log on disk", () => {
    let dir: string;
    let log: string;
    let previous: string | undefined;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbt-spy-test-"));
      log = path.join(dir, "dbt-invocations.log");
      previous = process.env[DBT_SPY_LOG_ENV];
      process.env[DBT_SPY_LOG_ENV] = log;
    });

    afterEach(() => {
      if (previous === undefined) {
        delete process.env[DBT_SPY_LOG_ENV];
      } else {
        process.env[DBT_SPY_LOG_ENV] = previous;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const write = (...lines: string[]) =>
      fs.writeFileSync(log, lines.map((line) => `${line}\n`).join(""));

    it("counts starts and ignores the lines between a multi-line argument's records", async () => {
      // The argv had a newline, so the wrapper wrote one record and the rest of the argument would be stray lines.
      write(
        "1000 start 1-1000 show",
        " select 1",
        ")",
        "* from a --limit 500",
        "1001 exit 1-1000 0",
      );

      expect(dbtInvocations()).toEqual([{ id: "1-1000", subcommand: "show" }]);
      expect(dbtInvocationsSince(0, "show")).toHaveLength(1);
      expect(dbtInvocationsSince(0, "parse")).toHaveLength(0);
      expect(await waitForDbtExits(0, 0)).toEqual([]);
    });

    it("pairs each exit with its own start when invocations interleave", async () => {
      // Two overlapping invocations with the same subcommand. Id pairing keeps the second open after the first exits.
      write(
        "1000 start 1-1000 compile",
        "1001 start 2-1001 compile",
        "1002 exit 1-1000 0",
      );

      expect(dbtInvocations()).toHaveLength(2);
      expect(await waitForDbtExits(0, 0)).toEqual([
        { id: "2-1001", subcommand: "compile" },
      ]);

      fs.appendFileSync(log, "1003 exit 2-1001 0\n");
      expect(await waitForDbtExits(0, 0)).toEqual([]);
    });

    it("leaves the long-running language server out of the open invocations", async () => {
      write("1000 start 1-1000 lsp");

      expect(await waitForDbtExits(0, 0)).toEqual([]);
    });

    it("waits for a late start to exit before the run counts as quiet", async () => {
      write("1000 start 1-1000 build", "1001 exit 1-1000 0");

      expect(await waitForDbtQuiet(0, 10, 1_000)).toEqual([]);
      expect(dbtInvocations()).toHaveLength(1);
    });

    it("reports an invocation that never exits when the quiet wait times out", async () => {
      write("1000 start 1-1000 build");

      expect(await waitForDbtQuiet(0, 10, 300)).toEqual([
        { id: "1-1000", subcommand: "build" },
      ]);
    });
  });
});
