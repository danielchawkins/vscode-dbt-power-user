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
import { EventEmitter, languages, Uri, workspace } from "vscode";
import { DbtTemplateLanguage } from "../../projects/dbtTemplateLanguage";
import { ProjectContext } from "../../projects/projectContext";
import { ProjectRegistry } from "../../projects/projectRegistry";

describe("DbtTemplateLanguage", () => {
  let root: string;
  let opened: (doc: unknown) => void;
  let userAssociations: Record<string, string>;
  const setLanguage = jest.fn(async (doc: unknown, _language: string) => doc);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fpu-lang-"));
    fs.writeFileSync(
      path.join(root, "dbt_project.yml"),
      "name: p\nmodel-paths: [transform]\n",
    );
    (
      languages as unknown as { setTextDocumentLanguage: unknown }
    ).setTextDocumentLanguage = setLanguage;
    (workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
    (
      workspace as unknown as { onDidOpenTextDocument: unknown }
    ).onDidOpenTextDocument = (listener: (doc: unknown) => void) => {
      opened = listener;
      return { dispose: () => undefined };
    };
    (
      workspace as unknown as { onDidSaveTextDocument: unknown }
    ).onDidSaveTextDocument = () => ({
      dispose: () => undefined,
    });
    userAssociations = {};
    (workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, fallback: unknown) => userAssociations ?? fallback,
    });
    setLanguage.mockClear();
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const create = () => {
    const project = { root: Uri.file(root), folder: { uri: Uri.file(root) } };
    const registry = {
      onDidChangeProjects: new EventEmitter<void>().event,
    } as unknown as ProjectRegistry;
    const context = {
      forResource: (uri: Uri) =>
        uri.fsPath.startsWith(root) ? project : undefined,
    } as unknown as ProjectContext;
    const terminal = { debug: jest.fn() } as never;
    const subject = new DbtTemplateLanguage(registry, context, terminal);
    subject.start();
    return subject;
  };
  const doc = (rel: string, languageId = "sql") => ({
    uri: Uri.file(path.join(root, rel)),
    languageId,
  });

  it.each([
    ["transform/stg/a.sql", "sql", true],
    ["macros/m.sql", "sql", true],
    ["target/compiled/p/transform/a.sql", "sql", false],
    ["models/a.sql", "sql", false],
    ["transform/a.sql", "snowflake-sql", false],
    ["transform/a.sql", "jinja-sql", false],
  ])("%s opened as %s → switch %s", async (rel, languageId, expected) => {
    const subject = create();
    const d = doc(rel, languageId);
    opened(d);
    await new Promise((r) => setImmediate(r));
    expect(setLanguage.mock.calls.length > 0).toBe(expected);
    if (expected) {
      expect(setLanguage).toHaveBeenCalledWith(d, "jinja-sql");
    }
    subject.dispose();
  });

  it("leaves a file alone when the user's files.associations names it", async () => {
    const subject = create();
    userAssociations = { "**/transform/**/*.sql": "snowflake-sql" };
    opened(doc("transform/a.sql"));
    await new Promise((r) => setImmediate(r));
    expect(setLanguage).not.toHaveBeenCalled();
    subject.dispose();
  });
});
