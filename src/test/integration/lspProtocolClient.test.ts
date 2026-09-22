import * as assert from "assert";
import * as net from "net";
import { attachLspProtocolClient, LspRequestError } from "./lspProtocolClient";

const HEADER_DELIMITER = "\r\n\r\n";

function frame(json: string): Buffer {
  const body = Buffer.from(json, "utf-8");
  const header = `Content-Length: ${body.length}${HEADER_DELIMITER}`;
  return Buffer.concat([Buffer.from(header, "ascii"), body]);
}

function frames(...messages: string[]): Buffer {
  return Buffer.concat(messages.map((message) => frame(message)));
}

async function withLoopbackPair(
  run: (clientSocket: net.Socket, serverSocket: net.Socket) => Promise<void>,
): Promise<void> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  const serverSocketPromise = new Promise<net.Socket>((resolve, reject) => {
    server.once("connection", resolve);
    server.once("error", reject);
  });
  const clientSocket = await new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () =>
      resolve(socket),
    );
    socket.once("error", reject);
  });
  const serverSocket = await serverSocketPromise;

  try {
    await run(clientSocket, serverSocket);
  } finally {
    if (!clientSocket.destroyed) {
      clientSocket.destroy();
    }
    if (!serverSocket.destroyed) {
      serverSocket.destroy();
    }
    server.close();
  }
}

function readServerMessages(serverSocket: net.Socket): {
  nextMessage(): Promise<Record<string, unknown>>;
} {
  let buffer = Buffer.alloc(0);
  const queue: Record<string, unknown>[] = [];
  const waiters: Array<(message: Record<string, unknown>) => void> = [];

  serverSocket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      const delimiter = buffer.indexOf(Buffer.from(HEADER_DELIMITER));
      if (delimiter === -1) {
        return;
      }
      const header = buffer.subarray(0, delimiter).toString("ascii");
      const match = header.match(/^Content-Length:\s*(\d+)\s*$/m);
      if (!match) {
        return;
      }
      const length = parseInt(match[1], 10);
      const bodyStart = delimiter + HEADER_DELIMITER.length;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) {
        return;
      }
      const body = buffer.subarray(bodyStart, bodyEnd).toString("utf-8");
      buffer = buffer.subarray(bodyEnd);
      const message = JSON.parse(body) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) {
        waiter(message);
      } else {
        queue.push(message);
      }
    }
  });

  return {
    nextMessage(): Promise<Record<string, unknown>> {
      const queued = queue.shift();
      if (queued) {
        return Promise.resolve(queued);
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

suite("lspProtocolClient", function () {
  test("parses multiple messages in one chunk and partial frames", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket);
      const reader = readServerMessages(serverSocket);

      const firstRequest = reader.nextMessage();
      const firstPromise = client.request("probe", {});
      const firstMessage = await firstRequest;
      serverSocket.write(
        frames(
          JSON.stringify({
            jsonrpc: "2.0",
            id: firstMessage.id,
            result: { first: true },
          }),
          JSON.stringify({
            jsonrpc: "2.0",
            method: "window/logMessage",
            params: { type: 3, message: "ready" },
          }),
        ),
      );

      assert.deepStrictEqual(await firstPromise, { first: true });
      const log = await client.waitForNotification(
        "window/logMessage",
        (params) =>
          typeof params === "object" &&
          params !== null &&
          (params as { message?: string }).message === "ready",
        500,
      );
      assert.ok(log);

      const secondRequest = reader.nextMessage();
      const secondPromise = client.request("probe-two", {});
      const secondMessage = await secondRequest;
      const partial = frame(
        JSON.stringify({
          jsonrpc: "2.0",
          id: secondMessage.id,
          result: { second: true },
        }),
      );
      serverSocket.write(partial.subarray(0, 20));
      await new Promise((resolve) => setTimeout(resolve, 20));
      serverSocket.write(partial.subarray(20));

      assert.deepStrictEqual(await secondPromise, { second: true });
      client.close();
    });
  });

  test("routes concurrent requests with deterministic ids", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket);
      const reader = readServerMessages(serverSocket);

      const respond = async () => {
        const message = await reader.nextMessage();
        serverSocket.write(
          frame(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: { method: message.method, id: message.id },
            }),
          ),
        );
      };

      const [first, second] = await Promise.all([
        (async () => {
          const pending = client.request("one", {});
          await respond();
          return pending;
        })(),
        (async () => {
          const pending = client.request("two", {});
          await respond();
          return pending;
        })(),
      ]);

      assert.deepStrictEqual(first, { method: "one", id: 1 });
      assert.deepStrictEqual(second, { method: "two", id: 2 });
      client.close();
    });
  });

  test("rejects requests with LspRequestError preserving JSON-RPC code", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket);
      const reader = readServerMessages(serverSocket);

      const pending = client.request("prepareRename", { uri: "file:///x" });
      const outbound = await reader.nextMessage();
      serverSocket.write(
        frame(
          JSON.stringify({
            jsonrpc: "2.0",
            id: outbound.id,
            error: { code: -32600, message: "Invalid request" },
          }),
        ),
      );

      await assert.rejects(pending, (error: unknown) => {
        assert.ok(error instanceof LspRequestError);
        assert.strictEqual(error.method, "prepareRename");
        assert.strictEqual(error.code, -32600);
        return true;
      });
      client.close();
    });
  });

  test("continues dispatch when a notification subscriber throws", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket);
      const reader = readServerMessages(serverSocket);

      client.onNotification("window/logMessage", () => {
        throw new Error("subscriber failed");
      });

      const pending = client.request("still-live", {});
      const outbound = reader.nextMessage();
      serverSocket.write(
        frames(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "window/logMessage",
            params: { type: 3, message: "first" },
          }),
          JSON.stringify({
            jsonrpc: "2.0",
            method: "window/logMessage",
            params: { type: 3, message: "second" },
          }),
        ),
      );

      const requestMessage = await outbound;
      serverSocket.write(
        frame(
          JSON.stringify({
            jsonrpc: "2.0",
            id: requestMessage.id,
            result: { ok: true },
          }),
        ),
      );

      assert.deepStrictEqual(await pending, { ok: true });
      assert.strictEqual(
        client.getNotifications("window/logMessage").length,
        2,
      );
      assert.strictEqual(client.getErrors().length, 2);
      assert.ok(
        client
          .getErrors()
          .every((entry) => entry.method === "window/logMessage"),
      );
      assert.deepStrictEqual(client.getNotifications("window/logMessage")[1], {
        type: 3,
        message: "second",
      });
      client.close();
    });
  });

  test("rejects a wait when its predicate throws without closing the socket", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket);

      const waiting = client.waitForNotification(
        "$/progress",
        () => {
          throw new Error("predicate failed");
        },
        500,
      );

      serverSocket.write(
        frame(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "$/progress",
            params: { value: { kind: "begin" } },
          }),
        ),
      );

      await assert.rejects(waiting, /predicate failed/);
      assert.strictEqual(client.getErrors().length, 1);
      assert.strictEqual(client.getErrors()[0]?.method, "$/progress");

      const reader = readServerMessages(serverSocket);
      const pending = client.request("after-wait-failure", {});
      const outbound = reader.nextMessage();
      serverSocket.write(
        frame(
          JSON.stringify({
            jsonrpc: "2.0",
            id: (await outbound).id,
            result: { stillConnected: true },
          }),
        ),
      );
      assert.deepStrictEqual(await pending, { stillConnected: true });
      client.close();
    });
  });

  test("answers built-in server requests and captures notifications", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket, {
        workspaceConfiguration: [{ section: "dbt", settings: { lint: false } }],
      });
      const reader = readServerMessages(serverSocket);

      serverSocket.write(
        frames(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "wdp-1",
            method: "window/workDoneProgress/create",
            params: { token: "token" },
          }),
          JSON.stringify({
            jsonrpc: "2.0",
            id: "cfg-1",
            method: "workspace/configuration",
            params: { items: [{ section: "dbt" }] },
          }),
          JSON.stringify({
            jsonrpc: "2.0",
            id: "reg-1",
            method: "client/registerCapability",
            params: { registrations: [] },
          }),
          JSON.stringify({
            jsonrpc: "2.0",
            method: "$/progress",
            params: {
              token: "dbt/progress/analyzing",
              value: { kind: "begin", title: "Analyzing" },
            },
          }),
          JSON.stringify({
            jsonrpc: "2.0",
            method: "textDocument/publishDiagnostics",
            params: {
              uri: "file:///tmp/example.sql",
              diagnostics: [{ message: "sample diagnostic" }],
            },
          }),
        ),
      );

      const responses: Record<string, unknown>[] = [];
      for (let index = 0; index < 3; index += 1) {
        responses.push(await reader.nextMessage());
      }

      const byId = new Map(
        responses.map((response) => [response.id, response]),
      );
      assert.strictEqual(byId.get("wdp-1")?.result, null);
      assert.deepStrictEqual(byId.get("cfg-1")?.result, [
        { section: "dbt", settings: { lint: false } },
      ]);
      assert.strictEqual(byId.get("reg-1")?.result, null);

      assert.strictEqual(client.notificationCount("$/progress"), 1);
      assert.strictEqual(
        client.notificationCount("textDocument/publishDiagnostics"),
        1,
      );
      assert.strictEqual(
        client.getServerRequests("workspace/configuration").length,
        1,
      );

      client.close();
    });
  });

  test("records configuration sections the handler actually delivered", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket, {
        configurationBySection: {
          dbt: { lint: true },
          editor: { tabSize: 2 },
        },
      });
      const reader = readServerMessages(serverSocket);

      serverSocket.write(
        frame(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "cfg-delivered",
            method: "workspace/configuration",
            params: { items: [{ section: "dbt" }, { section: "missing" }] },
          }),
        ),
      );

      const response = await reader.nextMessage();
      assert.deepStrictEqual(response.result, [{ lint: true }, null]);
      assert.deepStrictEqual(
        client.getConfigurationDeliveriesSince(0).map((entry) => ({
          requestedSections: entry.requestedSections,
          deliveredSections: entry.deliveredSections,
        })),
        [
          {
            requestedSections: ["dbt", "missing"],
            deliveredSections: ["dbt"],
          },
        ],
      );

      client.close();
    });
  });

  test("returns one workspace/configuration value per requested item", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket, {
        workspaceConfiguration: [
          { section: "dbt", settings: { lint: true } },
          { section: "editor", settings: { tabSize: 2 } },
        ],
      });
      const reader = readServerMessages(serverSocket);

      serverSocket.write(
        frame(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "cfg-multi",
            method: "workspace/configuration",
            params: {
              items: [
                { section: "dbt" },
                { section: "editor" },
                { section: "extra" },
              ],
            },
          }),
        ),
      );

      const response = await reader.nextMessage();
      assert.deepStrictEqual(response.result, [
        { section: "dbt", settings: { lint: true } },
        { section: "editor", settings: { tabSize: 2 } },
        null,
      ]);

      client.setWorkspaceConfiguration([]);
      serverSocket.write(
        frame(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "cfg-default",
            method: "workspace/configuration",
            params: { items: [{ section: "dbt" }, { section: "editor" }] },
          }),
        ),
      );
      const defaultResponse = await reader.nextMessage();
      assert.deepStrictEqual(defaultResponse.result, [null, null]);

      client.close();
    });
  });

  test("rejects pending requests with causal ECONNRESET", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      serverSocket.on("error", () => {});
      const client = attachLspProtocolClient(clientSocket);
      const pending = client.request("slow", {}, 500);
      const resetError = new Error("read ECONNRESET") as NodeJS.ErrnoException;
      resetError.code = "ECONNRESET";
      clientSocket.emit("error", resetError);
      await assert.rejects(pending, /ECONNRESET/);
      client.close();
    });
  });

  test("fatal missing Content-Length rejects pending requests and destroys socket", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket);
      const pending = client.request("missing-length", {}, 500);

      serverSocket.write(
        Buffer.from("Content-Type: application/json\r\n\r\n{}"),
      );

      await assert.rejects(pending, /LSP message missing Content-Length/);
      assert.ok(clientSocket.destroyed);
      client.close();
    });
  });

  test("fatal invalid JSON rejects pending requests and destroys socket", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket);
      const pending = client.request("invalid-json", {}, 500);

      serverSocket.write(frame("{not-json"));

      await assert.rejects(pending, /LSP message contains invalid JSON/);
      assert.ok(clientSocket.destroyed);
      client.close();
    });
  });

  test("stops dispatch after fatal framing error", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket);
      const pending = client.request("before-fatal", {}, 500);

      serverSocket.write(
        Buffer.concat([
          Buffer.from("Content-Type: application/json\r\n\r\n{}"),
          frame(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "window/logMessage",
              params: { type: 3, message: "after-fatal" },
            }),
          ),
        ]),
      );

      await assert.rejects(pending, /LSP message missing Content-Length/);
      assert.strictEqual(client.notificationCount("window/logMessage"), 0);
      client.close();
    });
  });

  test("records unhandled server requests before replying -32603", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket);
      const reader = readServerMessages(serverSocket);

      serverSocket.write(
        frame(
          JSON.stringify({
            jsonrpc: "2.0",
            id: "unknown-1",
            method: "client/unknownMethod",
            params: { secret: "payload" },
          }),
        ),
      );

      const response = await reader.nextMessage();
      const error = response.error as { code?: number; message?: string };
      assert.strictEqual(error?.code, -32603);
      assert.match(String(error?.message), /client\/unknownMethod/);
      assert.strictEqual(client.getErrors().length, 1);
      assert.strictEqual(client.getErrors()[0]?.method, "client/unknownMethod");
      assert.match(
        client.getErrors()[0]?.error.message ?? "",
        /Unhandled server request: client\/unknownMethod/,
      );
      client.close();
    });
  });

  test("waitForNotification respects fromIndex cursor", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket);

      serverSocket.write(
        frame(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "$/progress",
            params: { value: { kind: "begin", message: "stale" } },
          }),
        ),
      );

      await new Promise((resolve) => setTimeout(resolve, 20));
      const cursor = client.notificationCount("$/progress");
      assert.strictEqual(cursor, 1);

      const pending = client.waitForNotification(
        "$/progress",
        (params) =>
          typeof params === "object" &&
          params !== null &&
          (params as { value?: { message?: string } }).value?.message ===
            "fresh",
        500,
        cursor,
      );

      serverSocket.write(
        frame(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "$/progress",
            params: { value: { kind: "begin", message: "fresh" } },
          }),
        ),
      );

      assert.deepStrictEqual(await pending, {
        value: { kind: "begin", message: "fresh" },
      });

      await assert.rejects(
        client.waitForNotification(
          "$/progress",
          (params) =>
            typeof params === "object" &&
            params !== null &&
            (params as { value?: { message?: string } }).value?.message ===
              "stale",
          25,
          cursor,
        ),
        /LSP notification \$\/progress timed out after 25ms/,
      );

      client.close();
    });
  });

  test("stable cursors survive bounded-buffer shifts", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket, {
        notificationsPerMethod: 3,
      });

      for (let index = 0; index < 3; index += 1) {
        serverSocket.write(
          frame(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "$/progress",
              params: { value: { kind: "begin", message: `fill-${index}` } },
            }),
          ),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 20));

      const cursorAtSaturation = client.notificationCount("$/progress");
      assert.strictEqual(cursorAtSaturation, 3);

      const pending = client.waitForNotification(
        "$/progress",
        (params) =>
          typeof params === "object" &&
          params !== null &&
          (params as { value?: { message?: string } }).value?.message ===
            "after-shift",
        500,
        cursorAtSaturation,
      );

      serverSocket.write(
        frame(
          JSON.stringify({
            jsonrpc: "2.0",
            method: "$/progress",
            params: { value: { kind: "begin", message: "after-shift" } },
          }),
        ),
      );

      assert.deepStrictEqual(await pending, {
        value: { kind: "begin", message: "after-shift" },
      });
      assert.strictEqual(client.notificationCount("$/progress"), 4);
      assert.deepStrictEqual(
        client.getNotificationsSince("$/progress", cursorAtSaturation),
        [{ value: { kind: "begin", message: "after-shift" } }],
      );

      const entries = client.getNotificationEntries("$/progress");
      assert.strictEqual(entries.length, 3);
      assert.deepStrictEqual(
        entries.map((entry) => entry.absoluteIndex),
        [1, 2, 3],
      );

      client.close();
    });
  });

  test("wait scans retained entries when cursor predates the window", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket, {
        notificationsPerMethod: 2,
      });
      const staleCursor = client.notificationCount("$/progress");

      for (let index = 0; index < 3; index += 1) {
        serverSocket.write(
          frame(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "$/progress",
              params: {
                value: {
                  kind: "begin",
                  message: index === 2 ? "kept" : "drop",
                },
              },
            }),
          ),
        );
      }

      const matched = await client.waitForNotification(
        "$/progress",
        (params) =>
          typeof params === "object" &&
          params !== null &&
          (params as { value?: { message?: string } }).value?.message ===
            "kept",
        500,
        staleCursor,
      );
      assert.deepStrictEqual(matched, {
        value: { kind: "begin", message: "kept" },
      });
      client.close();
    });
  });

  test("timeout errors name the method only", async function () {
    await withLoopbackPair(async (clientSocket, serverSocket) => {
      const client = attachLspProtocolClient(clientSocket);

      await assert.rejects(
        client.request("initialize", {}, 25),
        /LSP request initialize timed out after 25ms/,
      );
      await assert.rejects(
        client.waitForNotification("$/progress", () => true, 25),
        /LSP notification \$\/progress timed out after 25ms/,
      );

      client.close();
    });
  });
});
