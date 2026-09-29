import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Uri, workspace } from "vscode";
import { readProjectSnapshot } from "../../projects/readProjectSnapshot";

describe("readProjectSnapshot", () => {
  let folder: string;
  let root: string;

  const mockSettings = (values: Record<string, unknown>) =>
    (workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string) => values[key]),
      has: jest.fn(),
      update: jest.fn(),
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
});
