import * as vscode from "vscode";

/** The `window` functions that open a dialog or a quick pick and so would block a test. */
export const STUBBED_WINDOW_FUNCTIONS = [
  "showQuickPick",
  "showInputBox",
  "showOpenDialog",
  "showWarningMessage",
  "showInformationMessage",
] as const;

export type StubbedWindowFunction = (typeof STUBBED_WINDOW_FUNCTIONS)[number];

/** Scripted answers per `window` function, each a queue consumed first in first out. */
export type UiAnswers = Partial<Record<StubbedWindowFunction, unknown[]>>;

/** The arguments of every call to each stubbed function, in call order, unscripted calls included. */
export type UiCalls = Partial<Record<StubbedWindowFunction, unknown[][]>>;

/** What a suite gets from {@link useUiStubs}: the queues to script and the calls the stubs have seen. */
export interface UiStubHandle {
  readonly answers: UiAnswers;
  readonly calls: UiCalls;
  /** Appends `values` to the queue of `name`, so the next calls to it answer with them in order. */
  script(name: StubbedWindowFunction, ...values: unknown[]): void;
}

/**
 * Replaces each stubbed `window` function with one that records its arguments and answers from the queue of
 * the same name. A call with an empty queue throws `unscripted window.<name>`.
 * @returns a `restore` that puts every original own-property descriptor back, or deletes the key when the
 * original had none.
 */
export function installUiStubs(
  answers: UiAnswers,
  calls: UiCalls = {},
): () => void {
  const target = vscode.window as unknown as Record<string, unknown>;
  const originals = STUBBED_WINDOW_FUNCTIONS.map(
    (name) => [name, Object.getOwnPropertyDescriptor(target, name)] as const,
  );
  for (const name of STUBBED_WINDOW_FUNCTIONS) {
    Object.defineProperty(target, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: (...args: unknown[]) => {
        (calls[name] ??= []).push(args);
        const queue = answers[name];
        if (!queue || queue.length === 0) {
          throw new Error(`unscripted window.${name}`);
        }
        return queue.shift();
      },
    });
  }
  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(target, name, descriptor);
      } else {
        delete target[name];
      }
    }
  };
}

/**
 * Runs `body` with the stubs installed. The originals come back when `body` resolves or throws; a throw is
 * rethrown unchanged.
 */
export async function withUiStubs<T>(
  answers: UiAnswers,
  body: () => T | Promise<T>,
): Promise<T> {
  const restore = installUiStubs(answers);
  try {
    return await body();
  } finally {
    restore();
  }
}

/**
 * Installs the stubs in each test of the enclosing mocha `suite` and restores them after it. Queues are emptied
 * before each test. Call it from a suite body: it registers `setup` and `teardown` hooks.
 */
export function useUiStubs(): UiStubHandle {
  const answers: UiAnswers = {};
  const calls: UiCalls = {};
  let restore: (() => void) | undefined;
  setup(() => {
    for (const name of STUBBED_WINDOW_FUNCTIONS) {
      delete answers[name];
      delete calls[name];
    }
    restore = installUiStubs(answers, calls);
  });
  teardown(() => {
    restore?.();
    restore = undefined;
  });
  return {
    answers,
    calls,
    script(name, ...values) {
      (answers[name] ??= []).push(...values);
    },
  };
}
