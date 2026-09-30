import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { Uri, workspace } from "vscode";
import {
  PROJECT_SNAPSHOT_SETTINGS,
  readProjectSnapshot,
} from "../../projects/readProjectSnapshot";
import { esmDirname } from "../esmDirname";

const sourcePath = path.resolve(
  esmDirname(import.meta.url),
  "../../projects/readProjectSnapshot.ts",
);

describe("readProjectSnapshot", () => {
  let folder: string;
  let root: string;

  const mockSettings = (values: Record<string, unknown>) =>
    (workspace.getConfiguration as Mock).mockReturnValue({
      get: vi.fn((key: string) => values[key]),
      has: vi.fn(),
      update: vi.fn(),
    });

  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "fpu-snapshot-"));
    root = path.join(folder, "proj");
    fs.mkdirSync(root);
    (workspace as any).workspaceFolders = [
      { uri: Uri.file(folder), name: "folder", index: 0 },
    ];
  });

  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true });
    mockSettings({});
    (workspace as any).workspaceFolders = [];
  });

  it("carries settings into the invocation", () => {
    mockSettings({ target: " prod ", profilesDir: "profiles" });

    const { folder: snapshotFolder, invocation } = readProjectSnapshot(
      Uri.file(root),
    );

    expect(snapshotFolder).toBe(folder);
    expect(invocation.target).toBe("prod");
    expect(invocation.profilesDir).toBe(path.join(folder, "profiles"));
  });

  it("reads the language server options for the root", () => {
    mockSettings({ "lint.enabled": false, "trace.server": "messages" });

    expect(readProjectSnapshot(Uri.file(root)).invocation.lsp).toEqual({
      lintEnabled: false,
      traceServer: "messages",
    });
  });

  it("reads paths and name from dbt_project.yml", () => {
    mockSettings({});
    fs.writeFileSync(
      path.join(root, "dbt_project.yml"),
      "name: shop\nmodel-paths: [src_models]\ntarget-path: build\n",
    );

    const snapshot = readProjectSnapshot(Uri.file(root));

    expect(snapshot.name).toBe("shop");
    expect(snapshot.paths.modelPaths).toEqual([path.join(root, "src_models")]);
    expect(snapshot.paths.targetPath).toBe(path.join(root, "build"));
  });

  it("lists every setting it reads in PROJECT_SNAPSHOT_SETTINGS", () => {
    const source = fs.readFileSync(sourcePath, "utf8");
    const read = [...source.matchAll(/readSetting\(\s*"([^"]+)"/g)].map(
      ([, key]) => key,
    );

    expect(read.length).toBeGreaterThan(0);
    expect(source).not.toMatch(/readSetting\(\s*[^"\s]/);
    expect([...PROJECT_SNAPSHOT_SETTINGS].sort()).toEqual(
      [...new Set(read)].sort(),
    );
  });
});
