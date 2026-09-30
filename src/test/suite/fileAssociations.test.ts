import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commands,
  ConfigurationTarget,
  Uri,
  window,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import {
  AssociationChanges,
  FileAssociationsCommand,
} from "../../features/projectSetup/fileAssociations";

const originalPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) =>
  Object.defineProperty(process, "platform", { value: platform });

describe("FileAssociationsCommand", () => {
  let root: string;
  let userValue: Record<string, string>;
  const glob = (...parts: string[]) =>
    `${path
      .join(root, ...parts)
      .split(path.sep)
      .join("/")}/**/*.sql`;
  const update = vi.fn((..._args: unknown[]) => Promise.resolve());

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fpu-assoc-"));
    fs.writeFileSync(
      path.join(root, "dbt_project.yml"),
      "name: p\nmodel-paths: [transform]\n",
    );
    userValue = {
      [glob("transform")]: "snowflake-sql",
      "*.py": "python",
    };
    update.mockClear();
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      inspect: () => ({
        key: "associations",
        globalValue: userValue,
      }),
      update,
    } as unknown as WorkspaceConfiguration);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setPlatform(originalPlatform);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const create = (gate = Promise.resolve()) =>
    new FileAssociationsCommand({ whenSettled: () => gate }, {
      projects: [{ root: Uri.file(root), folder: { uri: Uri.file(root) } }],
    } as never);

  const invoke = () => {
    const calls = vi
      .mocked(commands.registerCommand)
      .mock.calls.filter(
        ([id]) => id === "fusionPowerUser.configureFileAssociations",
      );
    const handler = calls[calls.length - 1][1] as () => Promise<
      AssociationChanges | undefined
    >;
    return handler();
  };

  it("waits for startup to settle before writing", async () => {
    let settle!: () => void;
    const subject = create(new Promise((resolve) => (settle = resolve)));
    const run = invoke();
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
    settle();
    expect(await run).toEqual({ added: 5, removed: 0 });
    subject.dispose();
  });

  it("reports a failed settings write", async () => {
    update.mockRejectedValueOnce(new Error("read-only"));
    const subject = create();
    expect(await invoke()).toBeUndefined();
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "Could not write dbt file associations: read-only",
    );
    subject.dispose();
  });

  it("registers the command at construction", () => {
    const subject = create();
    expect(commands.registerCommand).toHaveBeenCalledWith(
      "fusionPowerUser.configureFileAssociations",
      expect.any(Function),
    );
    subject.dispose();
  });

  it("adds missing template globs and keeps existing entries", async () => {
    const subject = create();
    expect(await subject.writeUserAssociations()).toEqual({
      added: 5,
      removed: 0,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      "associations",
      {
        [glob("transform")]: "snowflake-sql",
        "*.py": "python",
        [glob("macros")]: "jinja-sql",
        [glob("snapshots")]: "jinja-sql",
        [glob("analyses")]: "jinja-sql",
        [glob("tests")]: "jinja-sql",
        [glob("dbt_packages")]: "jinja-sql",
      },
      ConfigurationTarget.Global,
    );
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      "Updated dbt file associations in user settings: 5 added, 0 removed.",
    );
    subject.dispose();
  });

  it("writes every project's globs in one update", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "fpu-assoc-"));
    fs.writeFileSync(path.join(other, "dbt_project.yml"), "name: q\n");
    userValue = {};
    const subject = new FileAssociationsCommand(
      { whenSettled: () => Promise.resolve() },
      {
        projects: [root, other].map((r) => ({
          root: Uri.file(r),
          folder: { uri: Uri.file(path.dirname(r)) },
        })),
      } as never,
    );
    expect(await subject.writeUserAssociations()).toEqual({
      added: 12,
      removed: 0,
    });
    expect(update).toHaveBeenCalledTimes(1);
    const otherRoot = other.split(path.sep).join("/");
    expect(update.mock.calls[0][1]).toHaveProperty(
      `${otherRoot}/models/**/*.sql`,
      "jinja-sql",
    );
    subject.dispose();
    fs.rmSync(other, { recursive: true, force: true });
  });

  it("does not write when every glob is present", async () => {
    const subject = create();
    await subject.writeUserAssociations();
    userValue = update.mock.calls[0][1] as Record<string, string>;
    update.mockClear();
    expect(await subject.writeUserAssociations()).toEqual({
      added: 0,
      removed: 0,
    });
    expect(update).not.toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenLastCalledWith(
      "dbt file associations are already up to date.",
    );
    subject.dispose();
  });

  it("reads the project file on every invocation", async () => {
    const subject = create();
    userValue = {};
    fs.writeFileSync(path.join(root, "dbt_project.yml"), "name: p\n");
    await subject.writeUserAssociations();
    expect(update.mock.calls[0][1]).toHaveProperty(glob("models"), "jinja-sql");
    fs.writeFileSync(
      path.join(root, "dbt_project.yml"),
      "name: p\nmodel-paths: [marts]\n",
    );
    await subject.writeUserAssociations();
    expect(update.mock.calls[1][1]).toHaveProperty(glob("marts"), "jinja-sql");
    subject.dispose();
  });
  it("reports that no projects were found without writing", async () => {
    const subject = new FileAssociationsCommand(
      { whenSettled: () => Promise.resolve() },
      { projects: [] },
    );
    expect(await subject.writeUserAssociations()).toEqual({
      added: 0,
      removed: 0,
    });
    expect(update).not.toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenLastCalledWith(
      "No dbt projects found.",
    );
    subject.dispose();
  });

  it("removes stale template globs inside the project root only", async () => {
    const outside = `${path.dirname(root).split(path.sep).join("/")}/elsewhere/**/*.sql`;
    userValue = {
      [glob("old_models")]: "jinja-sql",
      [glob("custom")]: "sql",
      [outside]: "jinja-sql",
      "*.py": "python",
    };
    const subject = create();
    expect(await subject.writeUserAssociations()).toEqual({
      added: 6,
      removed: 1,
    });
    expect(update).toHaveBeenCalledTimes(1);
    const written = update.mock.calls[0][1] as Record<string, string>;
    expect(written).not.toHaveProperty(glob("old_models"));
    expect(written).toHaveProperty(glob("custom"), "sql");
    expect(written).toHaveProperty(outside, "jinja-sql");
    expect(written).toHaveProperty("*.py", "python");
    expect(written).toHaveProperty(glob("transform"), "jinja-sql");
    expect(window.showInformationMessage).toHaveBeenLastCalledWith(
      "Updated dbt file associations in user settings: 6 added, 1 removed.",
    );
    subject.dispose();
  });

  it("matches existing keys case-insensitively on macOS and Windows", async () => {
    setPlatform("darwin");
    const upper = glob("transform").toUpperCase();
    userValue = { [upper]: "jinja-sql" };
    const subject = create();
    expect(await subject.writeUserAssociations()).toEqual({
      added: 5,
      removed: 0,
    });
    const written = update.mock.calls[0][1] as Record<string, string>;
    expect(written).toHaveProperty(upper, "jinja-sql");
    expect(written).not.toHaveProperty(glob("transform"));
    subject.dispose();
  });

  it("matches existing keys case-sensitively on Linux", async () => {
    setPlatform("linux");
    const upper = glob("transform").toUpperCase();
    userValue = { [upper]: "jinja-sql" };
    const subject = create();
    expect(await subject.writeUserAssociations()).toEqual({
      added: 6,
      removed: 0,
    });
    const written = update.mock.calls[0][1] as Record<string, string>;
    expect(written).toHaveProperty(upper, "jinja-sql");
    expect(written).toHaveProperty(glob("transform"), "jinja-sql");
    subject.dispose();
  });

  it("warns about each skipped directory with its reason", async () => {
    fs.writeFileSync(
      path.join(root, "dbt_project.yml"),
      'name: p\nmodel-paths: [transform, "a{b"]\nmacro-paths: [.]\n',
    );
    userValue = {};
    const subject = create();
    await subject.writeUserAssociations();
    expect(window.showWarningMessage).toHaveBeenLastCalledWith(
      `Skipped dbt file associations for: ${path.join(root, "a{b")} (VS Code globs cannot match a literal "{"); ` +
        `${path.resolve(root)} (a glob on the project root would also match its target directory).`,
    );
    subject.dispose();
  });
});
