import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CompileSignal,
  languageClientOptions,
} from "../../fusion/lspClientSupport";

const noState = () => ({
  code: -32803,
  message: "no compiler state available to format this document",
});

type Next = (
  type: string,
  param?: unknown,
  token?: unknown,
) => Promise<unknown>;
type SendRequest = (
  type: string,
  param: unknown,
  token: unknown,
  next: Next,
) => Promise<unknown>;

function cancellable() {
  const listeners = new Set<() => void>();
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  return {
    token,
    cancel: () => {
      token.isCancellationRequested = true;
      [...listeners].forEach((listener) => listener());
    },
  };
}

/**
 * Mirrors the library: `client.sendRequest` runs `middleware.sendRequest` around the connection, and
 * the feature's failure handler (which shows the toast) only sees what escapes it.
 */
function setup() {
  const compiled = new CompileSignal();
  const info = vi.fn();
  const toast = vi.fn();
  const middleware = languageClientOptions({
    project: { folder: { uri: {}, name: "p", index: 0 } },
    selector: undefined,
    uriConverters: undefined,
    outputChannel: { info },
    diagnosticsFilter: { shouldForward: () => true },
    lintEnabled: false,
    compiled,
  } as unknown as Parameters<typeof languageClientOptions>[0]).middleware!;
  const sendRequest = middleware.sendRequest as unknown as SendRequest;
  const run = (method: string, connection: Next, token?: unknown) =>
    sendRequest(method, {}, token, connection).catch((error: unknown) => {
      toast(error);
      throw error;
    });
  return { compiled, info, toast, run };
}

describe("formatting retry in middleware.sendRequest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["textDocument/formatting", "textDocument/rangeFormatting"])(
    "%s: returns the edits without waiting when the first request succeeds",
    async (method) => {
      const { info, run, toast } = setup();
      const connection = vi.fn().mockResolvedValue(["edit"]);

      await expect(run(method, connection)).resolves.toEqual(["edit"]);
      expect(connection).toHaveBeenCalledTimes(1);
      expect(info).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    },
  );

  it.each(["textDocument/formatting", "textDocument/rangeFormatting"])(
    "%s: retries once after the next compile, with no error reaching the failure handler",
    async (method) => {
      const { compiled, info, run, toast } = setup();
      const connection = vi
        .fn()
        .mockRejectedValueOnce(noState())
        .mockResolvedValueOnce(["edit"]);

      const result = run(method, connection);
      await vi.advanceTimersByTimeAsync(0);
      compiled.notify();

      await expect(result).resolves.toEqual(["edit"]);
      expect(connection).toHaveBeenCalledTimes(2);
      expect(info).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    },
  );

  it("returns no edits, logs one line and raises no error when the retry fails too", async () => {
    const { info, run, toast } = setup();
    const connection = vi.fn().mockRejectedValue(noState());

    const result = run("textDocument/formatting", connection);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(result).resolves.toBeNull();
    expect(connection).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it("stops waiting and does not retry when the token is cancelled", async () => {
    const { info, run, toast } = setup();
    const { token, cancel } = cancellable();
    const connection = vi.fn().mockRejectedValue(noState());

    const result = run("textDocument/formatting", connection, token);
    await vi.advanceTimersByTimeAsync(10);
    cancel();

    await expect(result).resolves.toBeNull();
    expect(connection).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("propagates other errors without retrying", async () => {
    const { run } = setup();
    const failure = { code: -32603, message: "boom" };
    const connection = vi.fn().mockRejectedValue(failure);

    await expect(run("textDocument/formatting", connection)).rejects.toBe(
      failure,
    );
    expect(connection).toHaveBeenCalledTimes(1);
  });

  it("passes other methods through untouched", async () => {
    const { run } = setup();
    const failure = noState();
    const connection = vi.fn().mockRejectedValue(failure);

    await expect(run("textDocument/hover", connection)).rejects.toBe(failure);
    expect(connection).toHaveBeenCalledTimes(1);
  });

  it.each([
    { code: -32803, message: "other" },
    { code: -32603, message: "no compiler state" },
  ])("does not retry $code / $message", async (failure) => {
    const { run } = setup();
    const connection = vi.fn().mockRejectedValue(failure);

    await expect(run("textDocument/rangeFormatting", connection)).rejects.toBe(
      failure,
    );
    expect(connection).toHaveBeenCalledTimes(1);
  });
});
