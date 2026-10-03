/// <reference types="node" />
import {
  documentationEditor,
  lineage,
  queryResults,
} from "@fusion-power-user/webview-contract";
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { getVsCodeApiMock } from "../../test/setup";
import { handleIncomingResponse, panelRequests } from "./requestExecutor";

const modules = path.resolve(import.meta.dirname, "..");

/** Every non-test source file under `dir`. */
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(
      (e) =>
        e.isFile() &&
        /\.tsx?$/.test(e.name) &&
        !/\.(test|stories)\.tsx?$/.test(e.name),
    )
    .map((e) => path.join(e.parentPath, e.name));

/** The command literal of every `executeRequestIn*(` call in `files`, with the file it is in. */
const sentCommands = (files: string[]) =>
  files.flatMap((file) =>
    [
      ...readFileSync(file, "utf8").matchAll(
        /executeRequestIn(?:Sync|Async)\(\s*"([^"]+)"/g,
      ),
    ].map((match) => ({
      file: path.relative(modules, file),
      command: match[1],
    })),
  );

/** Commands every panel sends through a shared module rather than its own source. */
const SHARED_COMMANDS: readonly string[] = ["webview:ready"];

const panels = [
  {
    dir: "documentationEditor",
    commands: documentationEditor.panelCommands,
  },
  { dir: "queryPanel", commands: queryResults.panelCommands },
  { dir: "lineage", commands: lineage.panelCommands },
];

describe("panel senders", () => {
  it.each(panels)(
    "$dir sends only commands in its PanelMessage union",
    ({ dir, commands }) => {
      const sent = sentCommands(sources(path.join(modules, dir)));
      expect(sent.length).toBeGreaterThan(0);
      expect(
        sent.filter(({ command }) => !(commands as string[]).includes(command)),
      ).toEqual([]);
    },
  );

  it.each(panels)(
    "$dir sends every command in its PanelMessage union",
    ({ dir, commands }) => {
      // A command passed through a variable or ternary still appears as a string literal in the panel's source.
      const text = sources(path.join(modules, dir))
        .map((file) => readFileSync(file, "utf8"))
        .join("\n");
      expect(
        commands.filter(
          (command) =>
            !SHARED_COMMANDS.includes(command) &&
            !text.includes(JSON.stringify(command)),
        ),
      ).toEqual([]);
    },
  );

  it.each(panels)(
    "$dir imports no other panel's request functions",
    ({ dir }) => {
      const others = panels.map((p) => p.dir).filter((d) => d !== dir);
      const wrong = sources(path.join(modules, dir)).filter((file) => {
        const text = readFileSync(file, "utf8");
        return others.some((other) =>
          new RegExp(`["']@modules/${other}/requests["']`).test(text),
        );
      });
      expect(wrong).toEqual([]);
    },
  );
});

describe("panelRequests", () => {
  type Message =
    | { command: "ping" }
    | { command: "fetch"; id: number; syncRequestId?: string };
  const { executeRequestInAsync, executeRequestInSync } =
    panelRequests<Message>();

  it("posts the command with its payload", () => {
    executeRequestInAsync("ping");
    expect(getVsCodeApiMock().postMessage).toHaveBeenCalledWith({
      command: "ping",
    });
  });

  it("resolves a request with the body the host answers", async () => {
    const reply = executeRequestInSync("fetch", { id: 7 });
    const [[sent]] = getVsCodeApiMock().postMessage.mock.calls as [
      [{ command: string; id: number; syncRequestId: string }],
    ];
    expect(sent).toMatchObject({ command: "fetch", id: 7 });
    handleIncomingResponse({
      syncRequestId: sent.syncRequestId,
      status: true,
      body: "ok",
    });
    await expect(reply).resolves.toBe("ok");
  });

  it("rejects a request the host reports failed", async () => {
    const reply = executeRequestInSync("fetch", { id: 1 });
    const [[sent]] = getVsCodeApiMock().postMessage.mock.calls as [
      [{ syncRequestId: string }],
    ];
    handleIncomingResponse({
      syncRequestId: sent.syncRequestId,
      status: false,
      error: "Malformed request",
    });
    await expect(reply).rejects.toThrow("Malformed request");
  });

  it("rejects commands and payloads outside the union at compile time", () => {
    const typeChecks = () => {
      // @ts-expect-error not a command of the union
      executeRequestInAsync("unknown");
      // @ts-expect-error wrong payload type
      executeRequestInAsync("fetch", { id: "7" });
      // @ts-expect-error missing required payload
      executeRequestInAsync("fetch");
      // @ts-expect-error `ping` takes no `syncRequestId`, so the host never answers it
      void executeRequestInSync("ping");
      // @ts-expect-error `ping` carries nothing
      executeRequestInAsync("ping", { id: 7 });
      // @ts-expect-error `ping` carries nothing, not even an empty object
      executeRequestInAsync("ping", {});
      const either = "fetch" as "fetch" | "ping";
      // @ts-expect-error one member of the union requires a payload
      executeRequestInAsync(either);
    };
    expect(typeChecks).toBeTypeOf("function");
  });
});
