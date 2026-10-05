import type { ResponseArgs } from "@fusion-power-user/webview-contract";
import { vscode } from "@vscodeApi";

interface Message { command: string }

/** The member of `M` whose `command` can be `C`, including members whose `command` is itself a union. */
export type MessageOf<M extends Message, C extends string> = M extends {
  command: infer K;
}
  ? C extends K
    ? M
    : never
  : never;

/**
 * What a message with command `C` carries besides `command` and the executor's `syncRequestId`.
 * @internal
 */
export type Payload<M extends Message, C extends M["command"]> = M extends {
  command: infer K;
}
  ? C extends K
    ? Omit<M, "command" | "syncRequestId">
    : never
  : never;

/** Commands whose message accepts a `syncRequestId`, so the host answers them with a `response`. */
type RequestCommand<M extends Message> = Extract<
  M,
  { syncRequestId?: string }
>["command"];

/** `true` when some member of `P` has a required field. */
type RequiresPayload<P> = P extends unknown
  ? Record<never, never> extends P
    ? never
    : true
  : never;

/** `true` when some member of `P` has any field. */
type HasPayload<P> = P extends unknown
  ? [keyof P] extends [never]
    ? never
    : true
  : never;

/**
 * The payload argument: required when any member of `P` requires a field, so a union-typed command cannot drop it;
 * optional when every field is optional; absent when the command carries nothing.
 */
type PayloadArg<P> = [RequiresPayload<P>] extends [never]
  ? [HasPayload<P>] extends [never]
    ? []
    : [payload?: P]
  : [payload: P];

const pending = new Map<
  string,
  { resolve: (body: unknown) => void; reject: (error: Error) => void }
>();

/** The request functions `panelRequests` returns for the union `M`. */
export interface PanelRequests<M extends Message> {
  /** Posts `command` and resolves with the host's `response` body; rejects when the host reports a failure. */
  executeRequestInSync: <C extends RequestCommand<M>>(
    command: C,
    ...payload: PayloadArg<Payload<M, C>>
  ) => Promise<unknown>;
  /** Posts `command` without waiting for an answer. */
  executeRequestInAsync: <C extends M["command"]>(
    command: C,
    ...payload: PayloadArg<Payload<M, C>>
  ) => void;
}

/**
 * The request functions for one panel; `M` is that panel's `PanelMessage` union, so a command outside it, or a
 * payload that does not match its command, is a compile error.
 */
export const panelRequests = <M extends Message>(): PanelRequests<M> => ({
  executeRequestInSync: (command, ...[payload]) =>
    new Promise((resolve, reject) => {
      const syncRequestId = crypto.randomUUID();
      pending.set(syncRequestId, { resolve, reject });
      vscode.postMessage({ ...payload, command, syncRequestId });
    }),
  executeRequestInAsync: (command, ...[payload]) => {
    vscode.postMessage({ ...payload, command });
  },
});

/** Settles the request the host answered; a reply to no pending request is ignored. */
export const handleIncomingResponse = (args: ResponseArgs): void => {
  const id = args.syncRequestId;
  const request = id === undefined ? undefined : pending.get(id);
  if (!request) {
    return;
  }
  pending.delete(id!);
  if (args.status) {
    request.resolve(args.body);
  } else {
    request.reject(new Error(args.error));
  }
};
