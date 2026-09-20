import {
  CommandProcessExecution,
  CommandProcessExecutionFactory,
  DBTConfiguration,
  DBTTerminal,
} from "@altimateai/dbt-integration";
import { afterEach, describe, expect, it } from "@jest/globals";
import { anything, instance, mock, verify, when } from "ts-mockito";
import { Memento } from "vscode";
import {
  judgeFusionVersion,
  parseFusionVersion,
} from "../../fusion/fusionVersion";
import { FusionVersionDetection } from "../../fusion/fusionVersionDetection";

afterEach(() => {
  jest.clearAllMocks();
});

function createDetection(stdout: string, globalState?: Memento, stderr = "") {
  const execution = mock<CommandProcessExecution>();
  const executionFactory = mock(CommandProcessExecutionFactory);
  const configuration = mock<DBTConfiguration>();
  const terminal = mock<DBTTerminal>();

  when(execution.complete()).thenResolve({
    stdout,
    stderr,
    fullOutput: stdout,
  });
  when(executionFactory.createCommandProcessExecution(anything())).thenReturn(
    instance(execution),
  );
  when(configuration.getWorkingDirectory()).thenReturn("/workspace");

  return {
    detection: new FusionVersionDetection(
      instance(executionFactory),
      instance(terminal),
      instance(configuration),
      globalState,
    ),
    terminal,
  };
}

describe("Fusion version", () => {
  it("accepts the minimum supported Fusion version", () => {
    const raw = "dbt 2.0.5\n";

    expect(judgeFusionVersion(parseFusionVersion(raw), raw)).toEqual({
      kind: "ok",
      version: { major: 2, minor: 0, patch: 5, raw },
    });
  });

  it("allows an untested major version", () => {
    const raw = "dbt 3.0.0\n";

    expect(judgeFusionVersion(parseFusionVersion(raw), raw)).toEqual({
      kind: "untestedMajor",
      version: { major: 3, minor: 0, patch: 0, raw },
    });
  });

  it("rejects a Fusion version below the minimum", () => {
    const raw = "dbt 2.0.4\n";

    expect(judgeFusionVersion(parseFusionVersion(raw), raw)).toEqual({
      kind: "tooOld",
      version: { major: 2, minor: 0, patch: 4, raw },
    });
  });

  it("rejects dbt Core version output", () => {
    const raw = `Core:
  - installed: 1.8.8
  - latest:    1.8.8 - Up to date!

Plugins:
  - postgres: 1.8.2 - Up to date!
`;

    expect(judgeFusionVersion(parseFusionVersion(raw), raw)).toEqual({
      kind: "notFusion",
      raw,
    });
  });

  it("rejects empty version output", () => {
    expect(judgeFusionVersion(parseFusionVersion(""), "")).toEqual({
      kind: "notFusion",
      raw: "",
    });
  });

  it("detects the minimum supported Fusion version", async () => {
    const { detection } = createDetection("dbt 2.0.5\n");
    await expect(detection.detectDBT()).resolves.toBe(true);
  });

  it("detects Fusion even when --version writes to stderr", async () => {
    const { detection } = createDetection("dbt 2.0.5\n", undefined, "notice\n");
    await expect(detection.detectDBT()).resolves.toBe(true);
  });

  it("warns once per untested major version", async () => {
    const globalState = mock<Memento>();
    const key = "fusionVersion.warnedMajor.3";

    when(globalState.get<boolean>(key)).thenReturn(undefined, true);
    when(globalState.update(key, true)).thenResolve();

    const { detection, terminal } = createDetection(
      "dbt 3.0.0\n",
      instance(globalState),
    );

    await detection.detectDBT();
    await detection.detectDBT();

    verify(
      terminal.warn(
        "FusionVersionDetection",
        "dbt Fusion 3 has not been tested with Fusion Power User. Continuing.",
        false,
      ),
    ).once();
    verify(globalState.update(key, true)).once();
  });
});
