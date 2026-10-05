import { describe, expect, it, type Mock, vi } from "vitest";
import * as vscode from "vscode";
import { DBTCommand } from "../../dbt_integration/dbtIntegration";
import {
  CommandQueue,
  formatCommandStatus,
  QueuedCommandFailure,
} from "../../projects/commandQueue";

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("formatCommandStatus", () => {
  it("drops --project-dir and --profiles-dir and collapses whitespace", () => {
    const command = new DBTCommand("", [
      "run",
      "--select",
      "my_model",
      "--project-dir",
      "/p",
      "--profiles-dir",
      "/q",
    ]);

    expect(formatCommandStatus(command)).toBe("dbt run --select my_model");
  });
});

describe("CommandQueue", () => {
  it("runs commands one at a time in enqueue order", async () => {
    const queue = new CommandQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    void queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          events.push("first:start");
          releaseFirst = () => {
            events.push("first:end");
            resolve();
          };
        }),
      { statusMessage: "first" },
    );
    void queue.enqueue(
      async () => {
        events.push("second");
      },
      { statusMessage: "second" },
    );
    await settle();
    expect(events).toEqual(["first:start"]);
    expect(queue.busy).toBe(true);

    releaseFirst();
    await settle();
    expect(events).toEqual(["first:start", "first:end", "second"]);
    expect(queue.busy).toBe(false);
  });

  it("fires onFailed for a rejection and keeps running later commands", async () => {
    const queue = new CommandQueue();
    const failures: QueuedCommandFailure[] = [];
    queue.onFailed((failure) => failures.push(failure));
    const rejected = queue.enqueue(
      () => Promise.reject(new Error("cancelled")),
      { statusMessage: "dbt run --select my_model" },
    );
    const later = vi.fn(async () => "later");
    const settled = queue.enqueue(later, { statusMessage: "later" });

    await expect(rejected).rejects.toThrow("cancelled");
    await expect(settled).resolves.toBe("later");

    expect(failures).toHaveLength(1);
    expect(failures[0].statusMessage).toBe("dbt run --select my_model");
    expect(String(failures[0].error)).toBe("Error: cancelled");
    expect(later).toHaveBeenCalled();
  });

  it("propagates progress-token cancellation to the command's abort signal", async () => {
    const queue = new CommandQueue();
    let capturedCancel: (() => void) | undefined;
    (vscode.window.withProgress as Mock).mockImplementationOnce(
      (_options: unknown, task: any) => {
        const token = {
          onCancellationRequested: (cb: () => void) => {
            capturedCancel = cb;
            return { dispose: () => undefined };
          },
        };
        return task(undefined, token);
      },
    );

    let observedSignal: AbortSignal | undefined;
    const command = vi.fn((signal?: AbortSignal) => {
      observedSignal = signal;
      return new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve());
      });
    });

    void queue.enqueue(command, {
      statusMessage: "dbt run --select my_model",
      showProgress: true,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(command).toHaveBeenCalled();
    expect(observedSignal?.aborted).toBe(false);

    capturedCancel?.();
    await settle();

    expect(observedSignal?.aborted).toBe(true);
  });
});
