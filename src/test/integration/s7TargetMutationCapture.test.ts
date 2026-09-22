import * as assert from "assert";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { checkFusionVersion, fixturePath } from "./helpers/testFixtures";
import { createLspFixture, type LspFixture } from "./lspFixture";

const SNAPSHOT_INTERVAL_MS = 250;
const IDLE_AFTER_OPEN_MS = 8_000;
const WATCHER_DEBOUNCE_MS = 300;
const PLAIN_MODEL = "models/plain.sql";
const SENTINEL_REL = path.join("target", ".fpu_s7_sentinel");
const SENTINEL_BYTES = Buffer.from("fpu-s7-sentinel-v1", "utf-8");
const CLEAR_TARGET_TRIALS = 2;
const SERVER_PHASES = [
  "idle-after-didOpen",
  "edit-save",
  "listNodes",
  "compileLsp",
] as const;
const SUMMARY_PHASES = [
  "baseline",
  ...SERVER_PHASES,
  "pre-clearTarget-reference",
];

interface TargetFileState {
  relativePath: string;
  exists: boolean;
  size?: number;
  mtimeMs?: number;
  sha256?: string;
}

interface TargetSnapshot {
  atMs: number;
  phase: string;
  targetDirExists: boolean;
  manifest: TargetFileState;
  compiled: TargetFileState[];
}

interface ServerWatcherCapture {
  rawEvents: number;
  settledBursts: number;
  readAttempts: number;
  targetCreatedByServer: boolean;
}

interface PhaseRecord {
  name: string;
  durationMs: number;
  manifestSeen: boolean;
  compiledCount: number;
  targetDirSeen: boolean;
  progress: PhaseProgressCounts;
  editSession?: { didChangeSent: boolean; didSaveSent: boolean };
}

interface PhaseProgressCounts {
  analyzingBegin: number;
  analyzingEnd: number;
  lineageBegin: number;
  lineageEnd: number;
}

interface ClearTargetTrial {
  trial: number;
  compiledBefore: number;
  sentinelBefore: boolean;
  sentinelAfter: boolean;
  targetDirAfter: boolean;
  manifestAfter: boolean;
  compiledCountAfter: number;
}

interface ArtifactMutations {
  creates: number;
  contentRewrites: number;
  mtimeOnlyChanges: number;
  changedPaths: string[];
}

interface S7CaptureSummary {
  fusionVersion: string;
  launchExtras: string[];
  textDocumentSync: unknown;
  workDoneProgressCreateCount: number;
  baseline: {
    targetDirExists: boolean;
    manifestExists: boolean;
    compiledCount: number;
  };
  preClearReference: {
    targetDirExists: boolean;
    manifestExists: boolean;
    compiledCount: number;
  };
  phases: PhaseRecord[];
  artifactMutations: ArtifactMutations;
  phaseMutations: Record<
    string,
    Pick<ArtifactMutations, "creates" | "contentRewrites" | "mtimeOnlyChanges">
  >;
  snapshots: number;
  transientPaths: string[];
  compileWritesMeasured: boolean;
  clearTargetDestructiveMeasured: boolean;
  step71Verdict: "partial";
  watcherRateScope: string;
  serverWatcher: ServerWatcherCapture;
  manifestWriterVulnerability: "not_applicable";
  clearTargetTrials: ClearTargetTrial[];
  serverRequests: Record<string, number>;
  harnessErrors: number;
  harnessErrorMethods: string[];
  stderrBytes: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileUri(fsPath: string): string {
  return pathToFileURL(fsPath).href;
}

function hashFile(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function statFile(projectRoot: string, relativePath: string): TargetFileState {
  const absolutePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { relativePath, exists: false };
  }
  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    return { relativePath, exists: true, size: 0, mtimeMs: stat.mtimeMs };
  }
  return {
    relativePath,
    exists: true,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: hashFile(absolutePath),
  };
}

function walkCompiled(projectRoot: string): TargetFileState[] {
  const compiledRoot = path.join(projectRoot, "target", "compiled");
  if (!fs.existsSync(compiledRoot)) {
    return [];
  }
  const files: TargetFileState[] = [];
  const stack = [compiledRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      files.push(
        statFile(projectRoot, path.relative(projectRoot, absolutePath)),
      );
    }
  }
  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  return files;
}

function snapshotTarget(projectRoot: string, phase: string): TargetSnapshot {
  const targetDir = path.join(projectRoot, "target");
  return {
    atMs: Date.now(),
    phase,
    targetDirExists: fs.existsSync(targetDir),
    manifest: statFile(projectRoot, path.join("target", "manifest.json")),
    compiled: walkCompiled(projectRoot),
  };
}

function emptyMutations(): ArtifactMutations {
  return {
    creates: 0,
    contentRewrites: 0,
    mtimeOnlyChanges: 0,
    changedPaths: [],
  };
}

function isServerPhase(phase: string): phase is (typeof SERVER_PHASES)[number] {
  return SERVER_PHASES.includes(phase as (typeof SERVER_PHASES)[number]);
}

class TargetSnapshotCollector {
  readonly snapshots: TargetSnapshot[] = [];
  private knownState = new Map<string, { hash: string; mtimeMs: number }>();
  readonly serverPhaseMutations: ArtifactMutations = emptyMutations();
  private phaseMutationMap = new Map<string, ArtifactMutations>();

  recordBaseline(snapshot: TargetSnapshot): void {
    this.snapshots.push(snapshot);
  }

  take(projectRoot: string, phase: string): TargetSnapshot {
    const snapshot = snapshotTarget(projectRoot, phase);
    if (isServerPhase(phase)) {
      this.trackMutations(snapshot, phase);
    }
    this.snapshots.push(snapshot);
    return snapshot;
  }

  snapshotsForPhase(name: string): TargetSnapshot[] {
    return this.snapshots.filter((entry) => entry.phase === name);
  }

  phaseMutationsSummary(): Record<
    string,
    Pick<ArtifactMutations, "creates" | "contentRewrites" | "mtimeOnlyChanges">
  > {
    const summary: Record<
      string,
      Pick<
        ArtifactMutations,
        "creates" | "contentRewrites" | "mtimeOnlyChanges"
      >
    > = {};
    for (const phase of SERVER_PHASES) {
      const mutations = this.phaseMutationMap.get(phase) ?? emptyMutations();
      summary[phase] = {
        creates: mutations.creates,
        contentRewrites: mutations.contentRewrites,
        mtimeOnlyChanges: mutations.mtimeOnlyChanges,
      };
    }
    return summary;
  }

  private phaseMutations(phase: string): ArtifactMutations {
    const existing = this.phaseMutationMap.get(phase);
    if (existing) {
      return existing;
    }
    const created = emptyMutations();
    this.phaseMutationMap.set(phase, created);
    return created;
  }

  private trackMutations(snapshot: TargetSnapshot, phase: string): void {
    const phaseMutations = this.phaseMutations(phase);
    const files = [
      ...(snapshot.manifest.exists ? [snapshot.manifest] : []),
      ...snapshot.compiled,
    ];
    for (const file of files) {
      if (!file.sha256 || file.mtimeMs === undefined) {
        continue;
      }
      const prior = this.knownState.get(file.relativePath);
      if (prior === undefined) {
        this.knownState.set(file.relativePath, {
          hash: file.sha256,
          mtimeMs: file.mtimeMs,
        });
        this.serverPhaseMutations.creates += 1;
        phaseMutations.creates += 1;
        this.serverPhaseMutations.changedPaths.push(file.relativePath);
        continue;
      }
      if (prior.hash !== file.sha256) {
        this.knownState.set(file.relativePath, {
          hash: file.sha256,
          mtimeMs: file.mtimeMs,
        });
        this.serverPhaseMutations.contentRewrites += 1;
        phaseMutations.contentRewrites += 1;
        if (
          !this.serverPhaseMutations.changedPaths.includes(file.relativePath)
        ) {
          this.serverPhaseMutations.changedPaths.push(file.relativePath);
        }
        continue;
      }
      if (prior.mtimeMs !== file.mtimeMs) {
        this.knownState.set(file.relativePath, {
          hash: file.sha256,
          mtimeMs: file.mtimeMs,
        });
        this.serverPhaseMutations.mtimeOnlyChanges += 1;
        phaseMutations.mtimeOnlyChanges += 1;
      }
    }
  }

  transientPaths(reference: TargetSnapshot): string[] {
    const serverSnapshots = this.snapshots.filter(
      (entry) =>
        entry.phase === "baseline" ||
        SERVER_PHASES.includes(entry.phase as (typeof SERVER_PHASES)[number]),
    );
    const appeared = new Set<string>();
    for (const snapshot of serverSnapshots) {
      if (snapshot.targetDirExists) {
        appeared.add("target/");
      }
      if (snapshot.manifest.exists) {
        appeared.add(snapshot.manifest.relativePath);
      }
      for (const entry of snapshot.compiled) {
        appeared.add(entry.relativePath);
      }
    }
    const referencePaths = new Set<string>();
    if (reference.targetDirExists) {
      referencePaths.add("target/");
    }
    if (reference.manifest.exists) {
      referencePaths.add(reference.manifest.relativePath);
    }
    for (const entry of reference.compiled) {
      referencePaths.add(entry.relativePath);
    }
    return [...appeared]
      .filter((relativePath) => !referencePaths.has(relativePath))
      .sort();
  }

  phaseRecord(
    name: string,
    phaseSnapshots: TargetSnapshot[],
    progress: PhaseProgressCounts,
    editSession?: { didChangeSent: boolean; didSaveSent: boolean },
  ): PhaseRecord {
    const startMs = phaseSnapshots[0]?.atMs ?? 0;
    const endMs = phaseSnapshots[phaseSnapshots.length - 1]?.atMs ?? startMs;
    return {
      name,
      durationMs: endMs - startMs,
      manifestSeen: phaseSnapshots.some((entry) => entry.manifest.exists),
      compiledCount: Math.max(
        ...phaseSnapshots.map((entry) => entry.compiled.length),
        0,
      ),
      targetDirSeen: phaseSnapshots.some((entry) => entry.targetDirExists),
      progress,
      editSession,
    };
  }
}

class ServerTargetWatcher {
  private rootWatcher: fs.FSWatcher | null = null;
  private targetWatcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | undefined;
  private targetAttached = false;
  private stopped = false;
  readonly capture: ServerWatcherCapture = {
    rawEvents: 0,
    settledBursts: 0,
    readAttempts: 0,
    targetCreatedByServer: false,
  };

  start(projectRoot: string): void {
    this.rootWatcher = fs.watch(projectRoot, (_event, filename) => {
      if (this.stopped) {
        return;
      }
      if (
        filename === "target" ||
        fs.existsSync(path.join(projectRoot, "target"))
      ) {
        this.attachTargetWatcher(projectRoot);
      }
    });
  }

  noteTargetFromSnapshot(projectRoot: string): void {
    if (this.stopped) {
      return;
    }
    if (fs.existsSync(path.join(projectRoot, "target"))) {
      this.capture.targetCreatedByServer = true;
      this.attachTargetWatcher(projectRoot);
    }
  }

  private attachTargetWatcher(projectRoot: string): void {
    if (this.targetAttached || this.stopped) {
      return;
    }
    const targetDir = path.join(projectRoot, "target");
    if (!fs.existsSync(targetDir)) {
      return;
    }
    this.targetAttached = true;
    this.capture.targetCreatedByServer = true;
    this.targetWatcher = fs.watch(targetDir, () => {
      if (this.stopped) {
        return;
      }
      this.capture.rawEvents += 1;
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = undefined;
        this.onSettledBurst(projectRoot);
      }, WATCHER_DEBOUNCE_MS);
    });
  }

  stopAndFlushProject(projectRoot: string): void {
    if (this.stopped) {
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
      this.onSettledBurst(projectRoot);
    }
    this.stopped = true;
    this.targetWatcher?.close();
    this.targetWatcher = null;
    this.rootWatcher?.close();
    this.rootWatcher = null;
  }

  private onSettledBurst(projectRoot: string): void {
    this.capture.settledBursts += 1;
    this.capture.readAttempts += 1;
    this.tryReadManifest(path.join(projectRoot, "target", "manifest.json"));
  }

  private tryReadManifest(manifestPath: string): void {
    if (!fs.existsSync(manifestPath)) {
      return;
    }
    try {
      fs.readFileSync(manifestPath);
    } catch {
      // ignore read races
    }
  }
}

function progressValue(
  params: unknown,
): { kind?: string; title?: string; message?: string } | undefined {
  if (typeof params !== "object" || params === null) {
    return undefined;
  }
  const value = (params as { value?: unknown }).value;
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return value as { kind?: string; title?: string; message?: string };
}

function progressToken(params: unknown): string {
  if (typeof params !== "object" || params === null) {
    return "";
  }
  return String((params as { token?: string }).token ?? "");
}

function isAnalyzingProgress(params: unknown, kind: "begin" | "end"): boolean {
  const value = progressValue(params);
  if (!value || value.kind !== kind) {
    return false;
  }
  return value.title === "Analyzing" || value.message === "Analyzing";
}

function isLineageBegin(params: unknown): boolean {
  const value = progressValue(params);
  return value?.kind === "begin" && value.title === "Computing Lineage";
}

function countPhaseProgress(
  fixture: LspFixture,
  fromCursor: number,
  toCursor: number,
): PhaseProgressCounts {
  const entries = fixture
    .getNotificationEntries("$/progress")
    .filter(
      (entry) =>
        entry.absoluteIndex >= fromCursor && entry.absoluteIndex < toCursor,
    );
  const begins = entries.filter((entry) => isLineageBegin(entry.params));
  const beginTokens = new Set(
    begins.map((entry) => progressToken(entry.params)),
  );
  const ends = entries.filter((entry) => {
    const value = progressValue(entry.params);
    if (!value || value.kind !== "end") {
      return false;
    }
    return beginTokens.has(progressToken(entry.params));
  });
  return {
    analyzingBegin: entries.filter((entry) =>
      isAnalyzingProgress(entry.params, "begin"),
    ).length,
    analyzingEnd: entries.filter((entry) =>
      isAnalyzingProgress(entry.params, "end"),
    ).length,
    lineageBegin: begins.length,
    lineageEnd: ends.length,
  };
}

function permitsFullTextDidChange(textDocumentSync: unknown): boolean {
  if (textDocumentSync === 1 || textDocumentSync === 2) {
    return true;
  }
  if (typeof textDocumentSync !== "object" || textDocumentSync === null) {
    return false;
  }
  const change = (textDocumentSync as { change?: unknown }).change;
  return change === 1 || change === 2;
}

async function waitWithSnapshots(
  projectRoot: string,
  phase: string,
  durationMs: number,
  collector: TargetSnapshotCollector,
  watcher: ServerTargetWatcher,
): Promise<void> {
  const endMs = Date.now() + durationMs;
  while (Date.now() < endMs) {
    collector.take(projectRoot, phase);
    watcher.noteTargetFromSnapshot(projectRoot);
    await sleep(
      Math.min(SNAPSHOT_INTERVAL_MS, Math.max(0, endMs - Date.now())),
    );
    if (Date.now() >= endMs) {
      break;
    }
  }
}

async function runCompileLsp(
  fixture: LspFixture,
  projectRoot: string,
  phase: string,
  collector: TargetSnapshotCollector,
  watcher: ServerTargetWatcher,
): Promise<TargetSnapshot> {
  await fixture.request("workspace/executeCommand", {
    command: "dbt.compileLsp",
    arguments: [],
  });
  await waitWithSnapshots(projectRoot, phase, 2_000, collector, watcher);
  return snapshotTarget(projectRoot, phase);
}

function summarizeCapture(input: {
  fusionVersion: string;
  textDocumentSync: unknown;
  collector: TargetSnapshotCollector;
  watcher: ServerTargetWatcher;
  preClearReference: TargetSnapshot;
  clearTargetTrials: ClearTargetTrial[];
  fixture: LspFixture;
  phaseProgress: Map<string, PhaseProgressCounts>;
  editSession: { didChangeSent: boolean; didSaveSent: boolean };
}): S7CaptureSummary {
  const baseline = input.collector.snapshotsForPhase("baseline")[0];
  assert.ok(baseline, "baseline snapshot required");

  const compileWritesMeasured = input.collector.snapshots.some(
    (entry) =>
      SERVER_PHASES.includes(entry.phase as (typeof SERVER_PHASES)[number]) &&
      (entry.manifest.exists || entry.compiled.length > 0),
  );
  const clearTargetDestructiveMeasured =
    input.clearTargetTrials.length >= CLEAR_TARGET_TRIALS &&
    input.clearTargetTrials.every(
      (trial) =>
        trial.compiledBefore > 0 &&
        !trial.sentinelAfter &&
        !trial.targetDirAfter &&
        trial.compiledCountAfter === 0,
    );

  const requestCounts: Record<string, number> = {};
  for (const entry of input.fixture.getServerRequests(
    "client/registerCapability",
  )) {
    requestCounts[entry.method] = (requestCounts[entry.method] ?? 0) + 1;
  }
  requestCounts["workspace/configuration"] = input.fixture.getServerRequests(
    "workspace/configuration",
  ).length;
  requestCounts["window/workDoneProgress/create"] =
    input.fixture.serverRequestCount("window/workDoneProgress/create");
  const workDoneProgressCreateCount =
    requestCounts["window/workDoneProgress/create"];

  assert.ok(
    input.watcher.capture.rawEvents >= input.watcher.capture.settledBursts,
    "raw watch events must be at least settled bursts",
  );
  assert.strictEqual(
    input.watcher.capture.readAttempts,
    input.watcher.capture.settledBursts,
    "one read attempt per settled burst",
  );

  const summary: S7CaptureSummary = {
    fusionVersion: input.fusionVersion,
    launchExtras: ["--lint-enabled", "true", "--static-analysis", "baseline"],
    textDocumentSync: input.textDocumentSync,
    workDoneProgressCreateCount,
    baseline: {
      targetDirExists: baseline.targetDirExists,
      manifestExists: baseline.manifest.exists,
      compiledCount: baseline.compiled.length,
    },
    preClearReference: {
      targetDirExists: input.preClearReference.targetDirExists,
      manifestExists: input.preClearReference.manifest.exists,
      compiledCount: input.preClearReference.compiled.length,
    },
    phases: SUMMARY_PHASES.map((name) =>
      input.collector.phaseRecord(
        name,
        input.collector.snapshotsForPhase(name),
        input.phaseProgress.get(name) ?? {
          analyzingBegin: 0,
          analyzingEnd: 0,
          lineageBegin: 0,
          lineageEnd: 0,
        },
        name === "edit-save" ? input.editSession : undefined,
      ),
    ),
    artifactMutations: {
      creates: input.collector.serverPhaseMutations.creates,
      contentRewrites: input.collector.serverPhaseMutations.contentRewrites,
      mtimeOnlyChanges: input.collector.serverPhaseMutations.mtimeOnlyChanges,
      changedPaths: [
        ...input.collector.serverPhaseMutations.changedPaths,
      ].sort(),
    },
    phaseMutations: input.collector.phaseMutationsSummary(),
    snapshots: input.collector.snapshots.length,
    transientPaths: input.collector.transientPaths(input.preClearReference),
    compileWritesMeasured,
    clearTargetDestructiveMeasured,
    step71Verdict: "partial",
    watcherRateScope: "single-project-dummy-server-phases-only",
    serverWatcher: { ...input.watcher.capture },
    manifestWriterVulnerability: "not_applicable",
    clearTargetTrials: input.clearTargetTrials,
    serverRequests: requestCounts,
    harnessErrors: input.fixture.getErrors().length,
    harnessErrorMethods: input.fixture
      .getErrors()
      .map((entry) => entry.method)
      .sort(),
    stderrBytes: input.fixture.getStderr().length,
  };

  return summary;
}

suite("S7 target mutation capture", function () {
  this.timeout(180_000);

  const fusionVerdict = checkFusionVersion();

  suiteSetup(function () {
    if (fusionVerdict.kind !== "ok") {
      console.warn("Skipping S7 capture: dbt Fusion 2.0.5+ required on PATH.");
      this.skip();
    }
  });

  test("captures target mutation evidence in a temp fixture", async function () {
    const sourceRoot = fixturePath("single-project");
    const sourceChild = path.join(sourceRoot, "models/child.sql");
    const sourceBroken = path.join(sourceRoot, "models/broken_ref.sql");
    const sourcePlain = path.join(sourceRoot, PLAIN_MODEL);
    assert.ok(fs.existsSync(sourceChild));
    assert.ok(fs.existsSync(sourceBroken));
    assert.ok(!fs.existsSync(sourcePlain));
    assert.ok(!fs.existsSync(path.join(sourceRoot, "target")));

    const collector = new TargetSnapshotCollector();
    collector.recordBaseline(snapshotTarget(sourceRoot, "baseline"));

    const fixture = await createLspFixture(sourceRoot, sourceRoot, {
      extraArgs: ["--lint-enabled", "true", "--static-analysis", "baseline"],
      prepareProject(tempRoot) {
        for (const relativePath of [
          "models/child.sql",
          "models/broken_ref.sql",
        ]) {
          fs.unlinkSync(path.join(tempRoot, relativePath));
        }
        fs.writeFileSync(path.join(tempRoot, PLAIN_MODEL), "select 1 as id\n");
      },
    });

    const watcher = new ServerTargetWatcher();
    const clearTargetTrials: ClearTargetTrial[] = [];
    const phaseProgress = new Map<string, PhaseProgressCounts>();
    let textDocumentSync: unknown;
    const editSession = { didChangeSent: false, didSaveSent: false };

    try {
      watcher.start(fixture.projectRoot);
      await fixture.connect(30_000);

      const initResult = await fixture.request<{
        capabilities: Record<string, unknown>;
      }>("initialize", {
        processId: process.pid,
        rootUri: fileUri(fixture.projectRoot),
        workspaceFolders: [
          {
            uri: fileUri(fixture.projectRoot),
            name: path.basename(fixture.projectRoot),
          },
        ],
        capabilities: {
          window: { workDoneProgress: true },
          workspace: {
            configuration: true,
            didChangeWatchedFiles: { dynamicRegistration: true },
          },
          textDocument: {
            synchronization: { dynamicRegistration: true },
            publishDiagnostics: {},
            hover: {},
          },
        },
      });
      textDocumentSync = initResult.capabilities.textDocumentSync;
      assert.ok(
        permitsFullTextDidChange(textDocumentSync),
        "initialize must advertise numeric LSP sync kinds permitting text-only didChange",
      );
      fixture.notify("initialized", {});

      const projectRoot = fixture.projectRoot;
      const plainPath = path.join(projectRoot, PLAIN_MODEL);
      const plainUri = fileUri(plainPath);

      openDocument(fixture, path.join(projectRoot, "dbt_project.yml"), 1);
      openDocument(fixture, plainPath, 2);

      let progressCursor = fixture.notificationCount("$/progress");
      await waitWithSnapshots(
        projectRoot,
        "idle-after-didOpen",
        IDLE_AFTER_OPEN_MS,
        collector,
        watcher,
      );
      phaseProgress.set(
        "idle-after-didOpen",
        countPhaseProgress(
          fixture,
          progressCursor,
          fixture.notificationCount("$/progress"),
        ),
      );
      progressCursor = fixture.notificationCount("$/progress");

      const editedText = "select 2 as id\n";
      fixture.notify("textDocument/didChange", {
        textDocument: { uri: plainUri, version: 3 },
        contentChanges: [{ text: editedText }],
      });
      editSession.didChangeSent = true;
      fixture.notify("textDocument/didSave", {
        textDocument: { uri: plainUri, version: 3 },
      });
      editSession.didSaveSent = true;
      await waitWithSnapshots(
        projectRoot,
        "edit-save",
        2_000,
        collector,
        watcher,
      );
      phaseProgress.set(
        "edit-save",
        countPhaseProgress(
          fixture,
          progressCursor,
          fixture.notificationCount("$/progress"),
        ),
      );
      progressCursor = fixture.notificationCount("$/progress");

      await fixture.request("workspace/executeCommand", {
        command: "dbt.listNodes",
        arguments: [],
      });
      await waitWithSnapshots(
        projectRoot,
        "listNodes",
        2_000,
        collector,
        watcher,
      );
      phaseProgress.set(
        "listNodes",
        countPhaseProgress(
          fixture,
          progressCursor,
          fixture.notificationCount("$/progress"),
        ),
      );
      progressCursor = fixture.notificationCount("$/progress");

      let postCompile = await runCompileLsp(
        fixture,
        projectRoot,
        "compileLsp",
        collector,
        watcher,
      );
      assert.ok(
        postCompile.compiled.length > 0,
        "first compileLsp must write compiled artifacts",
      );
      postCompile = await runCompileLsp(
        fixture,
        projectRoot,
        "compileLsp",
        collector,
        watcher,
      );
      assert.ok(
        postCompile.compiled.length > 0,
        "second compileLsp must retain compiled artifacts",
      );
      phaseProgress.set(
        "compileLsp",
        countPhaseProgress(
          fixture,
          progressCursor,
          fixture.notificationCount("$/progress"),
        ),
      );

      watcher.stopAndFlushProject(projectRoot);
      const preClearReference = collector.take(
        projectRoot,
        "pre-clearTarget-reference",
      );
      assert.ok(
        preClearReference.compiled.length > 0,
        "pre-clear reference must capture server-written compiled artifacts",
      );

      for (let trial = 1; trial <= CLEAR_TARGET_TRIALS; trial += 1) {
        const phase = `clearTarget-trial-${trial}`;
        const compiledBefore = await runCompileLsp(
          fixture,
          projectRoot,
          phase,
          collector,
          watcher,
        );
        assert.ok(
          compiledBefore.compiled.length > 0,
          `trial ${trial} compileLsp must recreate server artifacts`,
        );
        fs.writeFileSync(path.join(projectRoot, SENTINEL_REL), SENTINEL_BYTES);
        const sentinelBefore = fs.existsSync(
          path.join(projectRoot, SENTINEL_REL),
        );
        await fixture.request("workspace/executeCommand", {
          command: "dbt.clearTarget",
          arguments: [],
        });
        collector.take(projectRoot, phase);
        const post = snapshotTarget(projectRoot, phase);
        clearTargetTrials.push({
          trial,
          compiledBefore: compiledBefore.compiled.length,
          sentinelBefore,
          sentinelAfter: fs.existsSync(path.join(projectRoot, SENTINEL_REL)),
          targetDirAfter: post.targetDirExists,
          manifestAfter: post.manifest.exists,
          compiledCountAfter: post.compiled.length,
        });
        assert.ok(!post.targetDirExists, `trial ${trial} must remove target/`);
        assert.ok(
          !fs.existsSync(path.join(projectRoot, SENTINEL_REL)),
          `trial ${trial} must remove sentinel`,
        );
        assert.strictEqual(
          post.compiled.length,
          0,
          `trial ${trial} must remove compiled artifacts`,
        );
      }

      const summary = summarizeCapture({
        fusionVersion:
          fusionVerdict.kind === "ok"
            ? `${fusionVerdict.version.major}.${fusionVerdict.version.minor}.${fusionVerdict.version.patch}`
            : "unknown",
        textDocumentSync,
        collector,
        watcher,
        preClearReference,
        clearTargetTrials,
        fixture,
        phaseProgress,
        editSession,
      });

      console.log(`FPU_S7_CAPTURE=${JSON.stringify(summary)}`);

      assert.ok(summary.compileWritesMeasured);
      assert.ok(summary.clearTargetDestructiveMeasured);
      assert.ok(
        summary.clearTargetTrials.length >= CLEAR_TARGET_TRIALS,
        "clearTarget should run at least twice",
      );
      assert.ok(
        summary.snapshots >= 10,
        "interval snapshots should cover phases",
      );
      assert.ok(fs.existsSync(sourceChild), "source child model unchanged");
      assert.ok(fs.existsSync(sourceBroken), "source broken_ref unchanged");
      assert.ok(!fs.existsSync(sourcePlain), "source must not gain plain.sql");
      assert.ok(!fs.existsSync(path.join(sourceRoot, "target")));
    } finally {
      watcher.stopAndFlushProject(fixture.projectRoot);
      await fixture.close();
    }
  });
});

function openDocument(
  fixture: LspFixture,
  filePath: string,
  version: number,
): void {
  const text = fs.readFileSync(filePath, "utf-8");
  fixture.notify("textDocument/didOpen", {
    textDocument: {
      uri: fileUri(filePath),
      languageId: filePath.endsWith(".yml") ? "yaml" : "jinja-sql",
      version,
      text,
    },
  });
}
