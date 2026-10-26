import * as assert from "node:assert";
import * as vscode from "vscode";
import type { FusionPowerUserApi } from "../../../extension";
import { sleep } from "../../async";

/**
 * Waits for Fusion Power User to activate and finish project startup.
 */
export async function waitForExtensionActivation(
  timeoutMs: number = 10_000,
): Promise<void> {
  const extensionId = "danielchawkins.fusion-power-user";

  await new Promise<void>((resolve, reject) => {
    const interval = setInterval(() => {
      if (vscode.extensions.getExtension(extensionId)?.isActive) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    }, 100);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      reject(
        new Error(`${extensionId} did not activate within ${timeoutMs}ms`),
      );
    }, timeoutMs);
  });
  const { ready } =
    vscode.extensions.getExtension<FusionPowerUserApi>(extensionId)!.exports;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${extensionId} did not finish startup within ${timeoutMs}ms`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads diagnostics for a file in the current workspace.
 * Returns an array of Diagnostic objects.
 */
export function readDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri);
}

/**
 * Requests completions at a given position in a document.
 * Filters to CompletionItem[] shape.
 */
export async function requestCompletions(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<vscode.CompletionItem[]> {
  const completions = await vscode.commands.executeCommand<
    vscode.CompletionList | vscode.CompletionItem[]
  >("vscode.executeCompletionItemProvider", document.uri, position);

  if (Array.isArray(completions)) {
    return completions;
  }
  return completions?.items ?? [];
}

/**
 * Executes a workspace command (extension-registered command).
 * Some commands may return a result; others return void.
 */
export async function executeCommand<T = unknown>(
  command: string,
  ...args: unknown[]
): Promise<T | undefined> {
  return vscode.commands.executeCommand<T>(command, ...args);
}

/**
 * Opens a file from the current workspace and returns the TextDocument.
 * Path is relative to the workspace folder.
 */
export async function openDocument(
  relativePath: string,
): Promise<vscode.TextDocument> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "No workspace folder is open");

  const uri = vscode.Uri.joinPath(folder.uri, relativePath);
  return vscode.workspace.openTextDocument(uri);
}

/**
 * Discards every unsaved document, shown or not, then closes all editor tabs, so neither the test nor the
 * window's shutdown waits on a save prompt.
 */
export async function closeAllEditors(): Promise<void> {
  for (const document of vscode.workspace.textDocuments.filter(
    (d) => d.isDirty,
  )) {
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
  }
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await sleep(500);
}
