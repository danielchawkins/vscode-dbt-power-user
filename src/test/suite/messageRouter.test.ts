import { describe, expect, it, vi } from "vitest";
import { dispatchMessage, Handlers } from "../../webview/messageRouter";

type Message = { command: "a"; n: number } | { command: "b" | "c" };

const isMessage = (value: unknown): value is Message => {
  const v = value as { command?: unknown; n?: unknown } | null;
  if (typeof v !== "object" || v === null) {
    return false;
  }
  return v.command === "a"
    ? typeof v.n === "number"
    : v.command === "b" || v.command === "c";
};

const sink = () => ({
  log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() } as any,
  reply: vi.fn(),
});

const handlers = () => {
  const map = { a: vi.fn(), b: vi.fn(), c: vi.fn() };
  return { map, typed: map as unknown as Handlers<Message> };
};

const failed = (syncRequestId: string, error: string) => ({
  command: "response",
  args: { syncRequestId, body: undefined, status: false, error },
});

describe("dispatchMessage", () => {
  it("hands a message that passes the guard to its command's handler", async () => {
    const { map, typed } = handlers();
    const s = sink();
    await dispatchMessage("t", { command: "a", n: 1 }, isMessage, typed, s);
    await dispatchMessage("t", { command: "c" }, isMessage, typed, s);
    expect(map.a).toHaveBeenCalledWith({ command: "a", n: 1 });
    expect(map.c).toHaveBeenCalledWith({ command: "c" });
    expect(map.b).not.toHaveBeenCalled();
    expect(s.reply).not.toHaveBeenCalled();
  });

  it.each([
    [{ command: "a", n: "1" }],
    [{ command: "z" }],
    [{ command: "toString" }],
    [null],
    ["a"],
    [[{ command: "a", n: 1 }]],
    [{ command: "a", syncRequestId: 7 }],
  ])(
    "drops and logs %j without calling a handler or replying",
    async (message) => {
      const { map, typed } = handlers();
      const s = sink();
      await dispatchMessage("t", message, isMessage, typed, s);
      expect(s.log.warn).toHaveBeenCalledTimes(1);
      expect(s.log.warn.mock.calls[0][0]).toBe("t:message");
      expect(s.reply).not.toHaveBeenCalled();
      for (const handler of Object.values(map)) {
        expect(handler).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    [{ command: "a", n: "1", syncRequestId: "r" }],
    [{ command: "z", syncRequestId: "r" }],
  ])(
    "answers a rejected request %j with a failed response",
    async (message) => {
      const { map, typed } = handlers();
      const s = sink();
      await dispatchMessage("t", message, isMessage, typed, s);
      expect(s.reply).toHaveBeenCalledExactlyOnceWith(
        failed("r", "Malformed request"),
      );
      expect(map.a).not.toHaveBeenCalled();
    },
  );

  it("logs a handler failure instead of throwing", async () => {
    const s = sink();
    const typed = {
      a: () => {
        throw new Error("boom");
      },
      b: () => Promise.reject(new Error("async boom")),
      c: vi.fn(),
    } satisfies Handlers<Message>;
    await expect(
      dispatchMessage("t", { command: "a", n: 1 }, isMessage, typed, s),
    ).resolves.toBeUndefined();
    await expect(
      dispatchMessage("t", { command: "b" }, isMessage, typed, s),
    ).resolves.toBeUndefined();
    expect(s.log.error.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "t:a",
      "t:b",
    ]);
    expect(s.reply).not.toHaveBeenCalled();
  });

  it("answers a request whose handler fails with the error", async () => {
    const s = sink();
    const typed = {
      a: vi.fn(),
      b: () => Promise.reject(new Error("async boom")),
      c: () => Promise.reject("plain"),
    } satisfies Handlers<Message>;
    await dispatchMessage(
      "t",
      { command: "b", syncRequestId: "r1" },
      isMessage,
      typed,
      s,
    );
    await dispatchMessage(
      "t",
      { command: "c", syncRequestId: "r2" },
      isMessage,
      typed,
      s,
    );
    expect(s.reply.mock.calls).toEqual([
      [failed("r1", "async boom")],
      [failed("r2", "plain")],
    ]);
  });

  it("logs a reply that throws instead of throwing", async () => {
    const s = sink();
    s.reply.mockImplementation(() => {
      throw new Error("disposed");
    });
    await expect(
      dispatchMessage(
        "t",
        { command: "z", syncRequestId: "r" },
        isMessage,
        handlers().typed,
        s,
      ),
    ).resolves.toBeUndefined();
    expect(s.log.error.mock.calls[0][0]).toBe("t:reply");
  });
});

describe("Handlers", () => {
  it("rejects at compile time a map missing a command or carrying an extra one", () => {
    const h = vi.fn();
    const complete: Handlers<Message> = { a: h, b: h, c: h };
    // @ts-expect-error `c` has no handler
    const missing: Handlers<Message> = { a: h, b: h };
    // @ts-expect-error `d` is not a command
    const extra: Handlers<Message> = { a: h, b: h, c: h, d: h };
    const wrong = (m: { n: string }) => m;
    // @ts-expect-error `a`'s handler must accept `{ command: "a"; n: number }`
    const mistyped: Handlers<Message> = { a: wrong, b: h, c: h };
    expect([complete, missing, extra, mistyped]).toHaveLength(4);
  });
});
