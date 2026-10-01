import type { Response } from "@fusion-power-user/webview-contract";
import { DBTTerminal } from "../dbt_integration";

/** The member of `M` whose `command` can be `C`, including members whose `command` is itself a union. */
export type MessageOf<
  M extends { command: string },
  C extends string,
> = M extends { command: infer K } ? (C extends K ? M : never) : never;

/** One handler per command of `M`; a missing or extra command is a compile error. */
export type Handlers<M extends { command: string }> = {
  readonly [C in M["command"]]: (message: MessageOf<M, C>) => unknown;
};

const describe = (value: unknown): string => {
  const command =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as { command?: unknown }).command
      : undefined;
  if (typeof command === "string") {
    return `command ${JSON.stringify(command.slice(0, 80))}`;
  }
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value;
};

/** The request id of a record that carries a string `syncRequestId`, whether or not it passed its guard. */
const requestIdOf = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const id = (value as { syncRequestId?: unknown }).syncRequestId;
  return typeof id === "string" ? id : undefined;
};

/** Posts a host message to the panel that sent the request. */
export type Reply = (response: Response) => unknown;

/** Where `dispatchMessage` logs, and how it answers the panel a message came from. */
export interface MessageSink {
  log: DBTTerminal;
  reply: Reply;
}

/** Answers request `syncRequestId` with `status: false`, the shape the panel's request executor rejects on. */
const settle = async (
  source: string,
  { log, reply }: MessageSink,
  syncRequestId: string,
  error: string,
) => {
  try {
    await reply({
      command: "response",
      args: { syncRequestId, body: undefined, status: false, error },
    });
  } catch (replyError) {
    log.error(
      `${source}:reply`,
      "Could not answer a webview request",
      replyError,
      false,
    );
  }
};

/**
 * Hands `message` to its command's handler when `guard` accepts it. A rejected message is logged as a warning
 * and dropped; a handler failure is logged as an error. Either way, a message carrying a string `syncRequestId`
 * gets a `status: false` reply, so the panel's pending request settles. Never throws.
 */
export async function dispatchMessage<M extends { command: string }>(
  source: string,
  message: unknown,
  guard: (value: unknown) => value is M,
  handlers: Handlers<M>,
  sink: MessageSink,
): Promise<void> {
  const syncRequestId = requestIdOf(message);
  if (!guard(message)) {
    sink.log.warn(
      `${source}:message`,
      `Dropped a malformed webview message (${describe(message)})`,
      false,
    );
    if (syncRequestId !== undefined) {
      await settle(source, sink, syncRequestId, "Malformed request");
    }
    return;
  }
  const handler = handlers[message.command as M["command"]] as (
    message: M,
  ) => unknown;
  try {
    await handler(message);
  } catch (error) {
    sink.log.error(
      `${source}:${message.command}`,
      "Webview message handler failed",
      error,
      false,
    );
    if (syncRequestId !== undefined) {
      const text = error instanceof Error ? error.message : String(error);
      await settle(source, sink, syncRequestId, text);
    }
  }
}
