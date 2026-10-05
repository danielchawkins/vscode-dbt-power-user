import { inspect } from "util";
import {
  commands,
  Disposable,
  env,
  Event,
  LogLevel,
  LogOutputChannel,
  OutputChannel,
  Uri,
  ViewColumn,
  window,
} from "vscode";
import type { Log } from "../core/log";
import { projectRootDigest } from "../core/project";
import { stripANSI } from "../utils";
import { DeclaredProject } from "./projectRegistry";

/**
 * The extension log's channel; each Declared Project's channel is this name, a colon and the project name.
 * @internal
 */
export const EXTENSION_CHANNEL_NAME = "Fusion Power User";
/** @internal */
export const DIAGNOSTICS_CHANNEL_NAME = "Fusion Power User - Diagnostics";

const SHOW_CHANNEL_COMMAND = "workbench.action.output.show.";
const OUTPUT_VIEW_FOCUS_COMMAND = "workbench.panel.output.focus";

/** Whether the host is Cursor, whose `LogOutputChannel.show` does nothing for an extension's log channel. */
function isCursor(): boolean {
  return env.uriScheme === "cursor" || /cursor/i.test(env.appName);
}

/**
 * Forwards to a log channel until disposed, then drops every call instead of throwing. In Cursor, `show` runs the
 * Output view's command for the channel and falls back to the channel's `show` when the command is missing or fails.
 */
class ClosableLogChannel implements LogOutputChannel {
  private closed = false;
  private showCommand: string | undefined;

  constructor(
    private readonly inner: LogOutputChannel,
    private readonly extensionId: string,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  get logLevel(): LogLevel {
    return this.inner.logLevel;
  }

  get onDidChangeLogLevel(): Event<LogLevel> {
    return this.inner.onDidChangeLogLevel;
  }

  trace(message: string, ...args: unknown[]): void {
    this.write(() => this.inner.trace(message, ...args));
  }

  debug(message: string, ...args: unknown[]): void {
    this.write(() => this.inner.debug(message, ...args));
  }

  info(message: string, ...args: unknown[]): void {
    this.write(() => this.inner.info(message, ...args));
  }

  warn(message: string, ...args: unknown[]): void {
    this.write(() => this.inner.warn(message, ...args));
  }

  error(error: string | Error, ...args: unknown[]): void {
    this.write(() => this.inner.error(error, ...args));
  }

  append(value: string): void {
    this.write(() => this.inner.append(value));
  }

  appendLine(value: string): void {
    this.write(() => this.inner.appendLine(value));
  }

  replace(value: string): void {
    this.write(() => this.inner.replace(value));
  }

  clear(): void {
    this.write(() => this.inner.clear());
  }

  show(preserveFocus?: boolean): void;
  show(column?: ViewColumn, preserveFocus?: boolean): void;
  show(
    columnOrPreserveFocus?: ViewColumn | boolean,
    preserveFocus?: boolean,
  ): void {
    const keepFocus =
      typeof columnOrPreserveFocus === "boolean"
        ? columnOrPreserveFocus
        : preserveFocus;
    const keep = keepFocus === true;
    this.write(() => {
      if (!isCursor()) {
        this.inner.show(keep);
        return;
      }
      this.reveal(keep).catch(() => {
        this.showCommand = undefined;
        this.write(() => this.inner.show(keep));
      });
    });
  }

  hide(): void {
    this.write(() => this.inner.hide());
  }

  dispose(): void {
    if (!this.closed) {
      this.closed = true;
      this.inner.dispose();
    }
  }

  private write(action: () => void): void {
    if (!this.closed) {
      action();
    }
  }

  /** The command preserves focus; focusing the Output view afterwards keeps the channel it selected. */
  private async reveal(preserveFocus: boolean): Promise<void> {
    const command = this.showCommand ?? (await this.findShowCommand());
    if (this.closed) {
      return;
    }
    if (!command) {
      this.inner.show(preserveFocus);
      return;
    }
    this.showCommand = command;
    await commands.executeCommand(command);
    if (!preserveFocus) {
      await commands.executeCommand(OUTPUT_VIEW_FOCUS_COMMAND);
    }
  }

  /** Cursor's id for the channel is `<extension id>.<file name>.workspaceId-<workspace id>`. */
  private async findShowCommand(): Promise<string | undefined> {
    const prefix = `${SHOW_CHANNEL_COMMAND}${this.extensionId}.${channelFileName(this.name)}.workspaceId-`;
    return (await commands.getCommands(true)).find((id) =>
      id.startsWith(prefix),
    );
  }
}

/** The host's log file name for a channel name, which its Output channel id embeds. */
function channelFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "");
}

/** A `Log` over one log output channel; calls after `dispose` are dropped. */
export class ChannelLog implements Log {
  /** The underlying channel, for a Fusion Client to log to; only this log's `dispose` closes it. */
  readonly channel: LogOutputChannel;

  /** `extensionId` is the id of the extension that creates the channel, which the host puts in its id. */
  constructor(name: string, extensionId: string) {
    this.channel = new ClosableLogChannel(
      window.createOutputChannel(name, { log: true }),
      extensionId,
    );
  }

  get name(): string {
    return this.channel.name;
  }

  debug(name: string, message: string, ...args: unknown[]): void {
    this.channel.debug(`${name}: ${stripANSI(message)}`, ...args);
  }

  info(name: string, message: string, ...args: unknown[]): void {
    this.channel.info(`${name}: ${stripANSI(message)}`, ...args);
  }

  warn(name: string, message: string, ...args: unknown[]): void {
    this.channel.warn(`${name}: ${stripANSI(message)}`, ...args);
  }

  error(name: string, message: string, e?: unknown, ...args: unknown[]): void {
    const cause =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : e
            ? inspect(e)
            : undefined;
    const text = cause ? `${message}: ${cause}` : message;
    this.channel.error(`${name}: ${stripANSI(text)}`, ...args);
  }

  output(text: string): void {
    this.channel.info(stripANSI(text));
  }

  /** Idempotent. */
  dispose(): void {
    this.channel.dispose();
  }
}

/** The registry view `OutputChannels` follows. */
export interface FollowedRegistry {
  readonly projects: readonly DeclaredProject[];
  readonly onDidChangeProjects: Event<void>;
}

/**
 * Owns every output channel the extension creates and is itself the extension log, for messages that belong to
 * no Declared Project. Each Declared Project gets its own log on first use; it is disposed once the followed
 * registry no longer holds that Declared Project, and every log is disposed with this one.
 */
export class OutputChannels extends ChannelLog implements Disposable {
  private readonly projectLogs = new Map<
    string,
    { project: DeclaredProject; log: ChannelLog }
  >();
  private registry: FollowedRegistry | undefined;
  private subscription: Disposable | undefined;
  private disposed = false;

  constructor(private readonly extensionId: string) {
    super(EXTENSION_CHANNEL_NAME, extensionId);
  }

  /** Disposes each project log when its Declared Project leaves `registry`. */
  follow(registry: FollowedRegistry): void {
    this.subscription?.dispose();
    this.registry = registry;
    this.subscription = registry.onDidChangeProjects(() => this.retain());
  }

  /**
   * The log of `project`, created on first use. A different Declared Project at the same root replaces the
   * earlier one's log. After `dispose`, returns this disposed log.
   */
  projectLog(project: DeclaredProject): ChannelLog {
    if (this.disposed) {
      return this;
    }
    const key = project.root.fsPath;
    const existing = this.projectLogs.get(key);
    if (existing?.project === project) {
      return existing.log;
    }
    existing?.log.dispose();
    const log = new ChannelLog(
      this.projectChannelName(project),
      this.extensionId,
    );
    this.projectLogs.set(key, { project, log });
    return log;
  }

  /** The log of the Declared Project rooted at `root`, or this log when there is none. */
  logFor(root: Uri): ChannelLog {
    return this.projectLogs.get(root.fsPath)?.log ?? this;
  }

  /** A new channel for the diagnostics report; the caller owns it. */
  createDiagnosticsChannel(): OutputChannel {
    return window.createOutputChannel(DIAGNOSTICS_CHANNEL_NAME, "log");
  }

  override dispose(): void {
    this.disposed = true;
    this.subscription?.dispose();
    this.subscription = undefined;
    for (const { log } of this.projectLogs.values()) {
      log.dispose();
    }
    this.projectLogs.clear();
    super.dispose();
  }

  private retain(): void {
    const current = this.registry?.projects ?? [];
    for (const [key, { project, log }] of this.projectLogs) {
      if (!current.includes(project)) {
        log.dispose();
        this.projectLogs.delete(key);
      }
    }
  }

  /**
   * Adds the root digest when another Declared Project in the followed registry has the same name. The name is
   * fixed when the channel is created; a later same-named Declared Project gets the digest and this one keeps its
   * name.
   */
  private projectChannelName(project: DeclaredProject): string {
    const name = `${EXTENSION_CHANNEL_NAME}: ${project.name}`;
    const shared = (this.registry?.projects ?? []).some(
      (other) =>
        other.name === project.name &&
        other.root.fsPath !== project.root.fsPath,
    );
    return shared
      ? `${name} (${projectRootDigest(project.root.fsPath)})`
      : name;
  }
}
