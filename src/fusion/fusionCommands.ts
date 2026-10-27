import type { CancellationToken, Disposable, Uri } from "vscode";
import { CancellationTokenSource } from "vscode";
import {
  type CompileFileResult,
  type CurrentNodeResult,
  ceilingMessage,
  FusionCommandError,
  type ListNodesResult,
  type ProjectInfo,
  REQUEST_POLICIES,
  type RequestPolicy,
  type RequestPurpose,
  toCommandError,
  toCompileFileResult,
  toCurrentNodeResult,
  toListNodesResult,
  toProjectInfo,
} from "../core/lsp";
import type { CompilePhase } from "./compileSignal";
import {
  FUSION_LSP_COMMANDS,
  type FusionClient,
  type FusionClientState,
} from "./fusionClient";

type FusionCommandsState = FusionClientState | "notRunning";

/** Why a request is sent, which picks its RequestPolicy, and the caller's token, which ends the wait early. */
interface RequestOptions {
  readonly purpose: RequestPurpose;
  readonly token?: CancellationToken;
}

/**
 * Every server command the extension sends, scheduled per project: one lane per command, one request in flight per
 * lane, and identical requests share one answer. Calls resolve the project's current client, so a restart never
 * leaves a stale reference. Rejects with {@link FusionCommandError}: `timeout` when the purpose's ceiling passes,
 * `cancelled` when the caller's token is cancelled, `notRunning` when the client cannot take the request.
 */
export interface FusionCommands {
  /** `notRunning` when the project has no client. */
  readonly state: FusionCommandsState;
  /** What the project's client is compiling now; `idle` without a client. */
  readonly compilePhase: CompilePhase;
  listNodes(
    selectors: readonly string[],
    request: RequestOptions,
  ): Promise<ListNodesResult>;
  /** `undefined`: the path is not a node. */
  getCurrentNode(
    relativePath: string,
    request: RequestOptions,
  ): Promise<CurrentNodeResult | undefined>;
  compileFile(uri: Uri, request: RequestOptions): Promise<CompileFileResult>;
  /** `undefined` until the first compile. */
  getProjectInfo(request: RequestOptions): Promise<ProjectInfo | undefined>;
}

type QueuedCommand = Exclude<
  (typeof FUSION_LSP_COMMANDS)[keyof typeof FUSION_LSP_COMMANDS],
  "dbt.show"
>;

/** A caller waiting for an entry's answer. */
interface Caller {
  readonly policy: RequestPolicy;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: FusionCommandError) => void;
  timer?: ReturnType<typeof setTimeout> | undefined;
  subscription?: Disposable | undefined;
}

/** What one server command sends, and how its answer becomes the command's result. */
interface CommandCall<T> {
  readonly command: QueuedCommand;
  readonly payload: unknown;
  readonly convert: (raw: unknown) => T;
}

/** One distinct request. Every caller that asks for it waits on the same entry and its answer. */
interface Entry {
  readonly key: string;
  readonly command: QueuedCommand;
  readonly payload: unknown;
  /** Turns the server's raw answer into the command's result, or throws the error the answer stands for. */
  readonly convert: (raw: unknown) => unknown;
  readonly callers: Set<Caller>;
  /** Interactive once any caller is interactive, so it goes ahead of queued background entries. */
  priority: RequestPolicy["priority"];
  /** How many times the server has cancelled this request. */
  serverCancels: number;
  /** The token the server request carries. Set while the request is in flight. */
  source?: CancellationTokenSource | undefined;
}

/** The requests of one command. One entry is in flight at a time; the lane is held until the server answers. */
interface Lane {
  readonly queue: Entry[];
  inFlight?: Entry | undefined;
  /** The client whose state changes wake the lane while its queued entries wait for it to run. */
  watched?:
    | {
        readonly client: FusionClient;
        readonly subscription: Disposable;
      }
    | undefined;
}

type Outcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: FusionCommandError };

function notRunning(client: FusionClient | undefined): FusionCommandError {
  return new FusionCommandError(
    "notRunning",
    `Fusion LSP client is not running (${client?.state ?? "notRunning"})`,
  );
}

class RequestLanes {
  private readonly lanes = new Map<QueuedCommand, Lane>();
  /** The entries a new caller may join, by command and arguments; a cancelled in-flight entry leaves at once. */
  private readonly entries = new Map<string, Entry>();
  private readonly clientOf: () => FusionClient | undefined;

  constructor(clientOf: () => FusionClient | undefined) {
    this.clientOf = clientOf;
  }

  request<T>(
    call: CommandCall<T>,
    { purpose, token }: RequestOptions,
  ): Promise<T> {
    const { command, payload, convert } = call;
    if (token?.isCancellationRequested) {
      return Promise.reject(
        new FusionCommandError("cancelled", "Request cancelled"),
      );
    }
    const policy = REQUEST_POLICIES[purpose];
    const lane = this.laneFor(command);
    const key = `${command} ${JSON.stringify(payload)}`;
    let entry = this.entries.get(key);
    if (entry) {
      if (policy.priority === "interactive") {
        entry.priority = "interactive";
      }
    } else {
      entry = {
        key,
        command,
        payload,
        convert,
        callers: new Set(),
        priority: policy.priority,
        serverCancels: 0,
      };
      this.entries.set(key, entry);
      lane.queue.push(entry);
    }
    const shared = entry;
    const answer = new Promise<unknown>((resolve, reject) => {
      const caller: Caller = { policy, resolve, reject };
      shared.callers.add(caller);
      // The ceiling runs from the call, not from the moment the request leaves the lane.
      caller.timer = setTimeout(() => {
        this.leave(
          shared,
          caller,
          new FusionCommandError("timeout", ceilingMessage(purpose)),
        );
      }, policy.ceilingMs);
      caller.subscription = token?.onCancellationRequested(() => {
        this.leave(
          shared,
          caller,
          new FusionCommandError("cancelled", "Request cancelled"),
        );
      });
    });
    this.pump(lane);
    return answer as Promise<T>;
  }

  private laneFor(command: QueuedCommand): Lane {
    let lane = this.lanes.get(command);
    if (!lane) {
      lane = { queue: [] };
      this.lanes.set(command, lane);
    }
    return lane;
  }

  /** Starts the next queued entry when the lane is free and its client is running. */
  private pump(lane: Lane): void {
    if (lane.inFlight) {
      return;
    }
    const client = this.clientOf();
    if (client?.state !== "running") {
      this.failWaiting(lane, client);
      if (client && lane.queue.length > 0) {
        this.watch(lane, client);
      } else {
        this.unwatch(lane);
      }
      return;
    }
    this.unwatch(lane);
    const interactive = lane.queue.findIndex(
      (entry) => entry.priority === "interactive",
    );
    const [next] = lane.queue.splice(interactive === -1 ? 0 : interactive, 1);
    if (next) {
      this.send(lane, next, client);
    }
  }

  /**
   * Ends the waits that cannot be met while the client is not running: every `fail` caller, and every caller once
   * the client is stopped, failed or missing.
   */
  private failWaiting(lane: Lane, client: FusionClient | undefined): void {
    const down =
      !client || client.state === "stopped" || client.state === "failed";
    for (const entry of lane.queue.slice()) {
      for (const caller of entry.callers) {
        if (down || caller.policy.whenNotRunning === "fail") {
          this.settle(entry, caller, notRunning(client));
        }
      }
      if (entry.callers.size === 0) {
        this.drop(entry);
      }
    }
  }

  private watch(lane: Lane, client: FusionClient): void {
    if (lane.watched?.client === client) {
      return;
    }
    this.unwatch(lane);
    lane.watched = {
      client,
      subscription: client.onDidChangeState(() => this.pump(lane)),
    };
  }

  private unwatch(lane: Lane): void {
    lane.watched?.subscription.dispose();
    lane.watched = undefined;
  }

  private send(lane: Lane, entry: Entry, client: FusionClient): void {
    const source = new CancellationTokenSource();
    lane.inFlight = entry;
    entry.source = source;
    let pending: Promise<unknown>;
    try {
      pending = client.request<unknown>(
        entry.command,
        entry.payload,
        source.token,
      );
    } catch (error) {
      pending = Promise.reject(toCommandError(error));
    }
    pending.then(entry.convert).then(
      (value) => this.finish(lane, entry, { ok: true, value }),
      (error: unknown) =>
        this.finish(lane, entry, { ok: false, error: toCommandError(error) }),
    );
  }

  private finish(lane: Lane, entry: Entry, outcome: Outcome): void {
    lane.inFlight = undefined;
    entry.source?.dispose();
    entry.source = undefined;
    if (
      !outcome.ok &&
      outcome.error.kind === "cancelled" &&
      entry.callers.size > 0
    ) {
      entry.serverCancels += 1;
      const retry = [...entry.callers].some(
        (caller) => caller.policy.serverCancelRetries >= entry.serverCancels,
      );
      if (retry) {
        lane.queue.unshift(entry);
        this.pump(lane);
        return;
      }
    }
    for (const caller of entry.callers) {
      this.retire(caller);
      if (outcome.ok) {
        caller.resolve(outcome.value);
      } else {
        caller.reject(outcome.error);
      }
    }
    entry.callers.clear();
    this.forget(entry);
    this.pump(lane);
  }

  /** Ends one caller's wait early, as its timer or token asks. An entry nobody still wants is dropped. */
  private leave(entry: Entry, caller: Caller, error: FusionCommandError): void {
    if (!this.settle(entry, caller, error)) {
      return;
    }
    if (entry.callers.size === 0) {
      this.drop(entry);
    }
    this.pump(this.laneFor(entry.command));
  }

  /** Rejects one caller still waiting on the entry; `false` when it has settled already. */
  private settle(
    entry: Entry,
    caller: Caller,
    error: FusionCommandError,
  ): boolean {
    if (!entry.callers.delete(caller)) {
      return false;
    }
    this.retire(caller);
    caller.reject(error);
    return true;
  }

  /**
   * Removes an entry nobody wants. A queued entry leaves the lane. A sent one is cancelled on the server and stops
   * being joinable, so a new identical caller sends its own request once the lane frees. The lane is held until the
   * server answers, because a second request while one runs makes the server slower.
   */
  private drop(entry: Entry): void {
    const lane = this.laneFor(entry.command);
    this.forget(entry);
    if (lane.inFlight === entry) {
      entry.source?.cancel();
      return;
    }
    const index = lane.queue.indexOf(entry);
    if (index !== -1) {
      lane.queue.splice(index, 1);
    }
  }

  /** Takes an entry out of the coalescing map, unless a newer entry has taken its key. */
  private forget(entry: Entry): void {
    if (this.entries.get(entry.key) === entry) {
      this.entries.delete(entry.key);
    }
  }

  private retire(caller: Caller): void {
    clearTimeout(caller.timer);
    caller.subscription?.dispose();
  }
}

export function createFusionCommands(
  clientOf: () => FusionClient | undefined,
): FusionCommands {
  const lanes = new RequestLanes(clientOf);

  return {
    get state() {
      return clientOf()?.state ?? "notRunning";
    },
    get compilePhase() {
      return clientOf()?.compileState.phase ?? "idle";
    },
    async listNodes(selectors, request) {
      return lanes.request(
        {
          command: FUSION_LSP_COMMANDS.listNodes,
          payload: [...selectors],
          convert: toListNodesResult,
        },
        request,
      );
    },
    async getCurrentNode(relativePath, request) {
      return lanes.request(
        {
          command: FUSION_LSP_COMMANDS.getCurrentNode,
          payload: [relativePath],
          convert: toCurrentNodeResult,
        },
        request,
      );
    },
    async compileFile(uri, request) {
      return lanes.request(
        {
          command: FUSION_LSP_COMMANDS.compileFile,
          payload: [uri.toString()],
          convert: toCompileFileResult,
        },
        request,
      );
    },
    async getProjectInfo(request) {
      return lanes.request(
        {
          command: FUSION_LSP_COMMANDS.getProjectInfo,
          payload: [],
          convert: toProjectInfo,
        },
        request,
      );
    },
  };
}
