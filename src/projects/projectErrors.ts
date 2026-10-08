import { existsSync } from "fs";
import * as os from "os";
import { commands, Disposable, EventEmitter, Uri, window } from "vscode";
import { firstLogLine, isConfigError, textLogErrors } from "../core/cli";
import { DBTDiagnosticData } from "../core/diagnostics";
import type { Log } from "../core/log";
import { ProjectSnapshot, resolveProfilesDir } from "../core/project";
import { CommandProcessResult } from "../core/types";

/** Where a project error came from; each source's errors are replaced independently. */
export type ProjectErrorSource = "parse" | "compile" | "executable";

export const SHOW_OUTPUT = "Show output";
export const SHOW_OUTPUT_COMMAND = "fusionPowerUser.showFusionOutput";
const LOG_SOURCE = "ProjectErrors";

/** What `errorHint` needs to name the directory dbt searched for `profiles.yml`. */
interface ProfilesSearch {
  root: string;
  environment: Readonly<Record<string, string | undefined>>;
  home: string;
  exists: (file: string) => boolean;
}

/**
 * The sentence that tells the user what to do about `message`, if it is a failure we recognize. With `search`, a
 * missing `profiles.yml` names the directory dbt looked in when no setting chose it.
 * @internal
 */
export function errorHint(
  message: string,
  invocation: Pick<ProjectSnapshot["invocation"], "profilesDir" | "target">,
  search?: ProfilesSearch,
): string | undefined {
  const envVar = /environment variable '([^']+)' not found/.exec(message)?.[1];
  if (envVar) {
    return (
      `The editor's environment lacks ${envVar}. Start the editor from a shell that sets it, ` +
      "or set it in your profile."
    );
  }
  if (/No profiles\.yml found/.test(message) && invocation.profilesDir) {
    return `fusionPowerUser.profilesDir is ${invocation.profilesDir}, which has no profiles.yml.`;
  }
  if (/No profiles\.yml found/.test(message) && search) {
    const dir = resolveProfilesDir(
      undefined,
      search.environment,
      search.root,
      search.home,
      search.exists,
    );
    return `dbt looked for profiles.yml in ${dir}.`;
  }
  const target = /target '([^']+)' not found in profile/.exec(message)?.[1];
  if (target) {
    return invocation.target === target
      ? `fusionPowerUser.target is ${target}; set it to a target the profile defines.`
      : `The profile has no output named ${target}.`;
  }
  return undefined;
}

/**
 * Reports one Declared Project's configuration failures: logs each new error in full to the project's channel and
 * shows one error notification per distinct first line until it clears. `current` is the first active error.
 */
export class ProjectErrors implements Disposable {
  private readonly active = new Map<ProjectErrorSource, string>();
  private readonly changed = new EventEmitter<void>();
  /** Fires when `current` may have changed. */
  readonly onDidChange = this.changed.event;
  private disposed = false;

  constructor(
    private readonly root: Uri,
    private readonly projectName: () => string,
    private readonly snapshot: () => ProjectSnapshot,
    private readonly terminal: Log,
  ) {}

  /** The first line of the first active error, if any. */
  get current(): string | undefined {
    return this.active.values().next().value;
  }

  /** Replaces the parse errors with the error-severity `diagnostics`. */
  reportParse(diagnostics: readonly DBTDiagnosticData[]): void {
    this.report(
      "parse",
      diagnostics
        .filter((data) => data.severity === "error")
        .map((data) => data.message),
    );
  }

  /** Replaces the compile errors with the configuration errors among `messages`. */
  reportCompile(messages: readonly string[]): void {
    this.report("compile", messages.filter(isConfigError));
  }

  /** A finished command's configuration errors replace the compile errors; a clean exit clears them. */
  reportCommand(result: CommandProcessResult | undefined): void {
    if (result?.exitCode === null || result?.exitCode === undefined) {
      return;
    }
    const errors = textLogErrors(`${result.stderr}\n${result.stdout}`).filter(
      isConfigError,
    );
    if (result.exitCode === 0 || errors.length > 0) {
      this.report("compile", errors);
    }
  }

  /** Replaces `source`'s errors with `messages`; an empty list clears them. */
  report(source: ProjectErrorSource, messages: readonly string[]): void {
    if (this.disposed) {
      return;
    }
    const previous = this.active.get(source);
    const shown = new Set(this.active.values());
    if (messages.length === 0) {
      this.active.delete(source);
      if (previous !== undefined) {
        this.changed.fire();
      }
      return;
    }
    const line = firstLogLine(messages[0] ?? "");
    this.active.set(source, line);
    if (line === previous) {
      return;
    }
    this.changed.fire();
    if (shown.has(line)) {
      return;
    }
    for (const message of messages) {
      this.terminal.error(LOG_SOURCE, message, undefined);
    }
    this.notify(line);
  }

  dispose(): void {
    this.disposed = true;
    this.active.clear();
    this.changed.dispose();
  }

  private notify(line: string): void {
    let hint: string | undefined;
    try {
      const { root, invocation } = this.snapshot();
      hint = errorHint(line, invocation, {
        root,
        environment: invocation.environment,
        home: os.homedir(),
        exists: existsSync,
      });
    } catch {
      hint = undefined;
    }
    const text = `${this.projectName()}: ${line}${hint ? ` ${hint}` : ""}`;
    void Promise.resolve(window.showErrorMessage(text, SHOW_OUTPUT)).then(
      (action) => {
        if (action === SHOW_OUTPUT) {
          void commands.executeCommand(SHOW_OUTPUT_COMMAND, this.root);
        }
      },
    );
  }
}
