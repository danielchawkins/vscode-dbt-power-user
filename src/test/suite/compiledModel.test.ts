import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import { URI } from "vscode-uri";
import { FusionCommandError } from "../../core/lsp";
import { compiledModelSql } from "../../projects/compiledModel";

vi.mock("vscode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vscode")>()),
  Uri: (await import("vscode-uri")).URI,
}));

describe("compiledModelSql", () => {
  it("reads the file compileFile returns, verbatim", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fpu-compiled-"));
    const file = path.join(dir, "orders.sql");
    fs.writeFileSync(file, "select 'é' as x\n");
    const lsp = {
      getProjectInfo: vi.fn(() => Promise.resolve({} as never)),
      compileFile: vi.fn(() =>
        Promise.resolve({ fileUri: URI.file(file).toString() }),
      ),
    };
    expect(await compiledModelSql(lsp, URI.file("/p/models/orders.sql"))).toBe(
      "select 'é' as x\n",
    );
    fs.rmSync(dir, { recursive: true });
  });

  it("asks nothing of the server before its first compile", async () => {
    const lsp = {
      getProjectInfo: vi.fn(() => Promise.resolve(undefined)),
      compileFile: vi.fn(),
    };
    expect(await compiledModelSql(lsp, URI.file("/p/a.sql"))).toBeUndefined();
    expect(lsp.compileFile).not.toHaveBeenCalled();
  });

  it("propagates the server error, such as a project that does not compile", async () => {
    const lsp = {
      getProjectInfo: vi.fn(() => Promise.resolve({} as never)),
      compileFile: vi.fn(() =>
        Promise.reject(
          new FusionCommandError("server", "Compiled file path not found."),
        ),
      ),
    };
    await expect(compiledModelSql(lsp, URI.file("/p/a.sql"))).rejects.toThrow(
      "Compiled file path not found.",
    );
  });
});
