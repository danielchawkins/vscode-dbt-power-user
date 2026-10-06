import { readFileSync } from "fs";
import { Uri } from "vscode";
import type { FusionCommands } from "../fusion/fusionCommands";

/**
 * The compiled SQL of the saved model at `model`, from the file `dbt.compileFile` returns, verbatim. `undefined`
 * until the server has finished its first compile, because an earlier request would start one.
 */
export async function compiledModelSql(
  lsp: Pick<FusionCommands, "getProjectInfo" | "compileFile">,
  model: Uri,
): Promise<string | undefined> {
  if ((await lsp.getProjectInfo()) === undefined) {
    return undefined;
  }
  const { fileUri } = await lsp.compileFile(model);
  return readFileSync(Uri.parse(fileUri).fsPath, "utf8");
}
