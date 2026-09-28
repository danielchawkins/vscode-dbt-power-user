import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";

const EXTENSION_ID = "danielchawkins.fusion-power-user";
const COMMAND = "fusionPowerUser.configureFileAssociations";
const trusted = process.env.FPU_VSIX_LABEL === "trusted-vsix";

function assertVsixInstalled(): void {
  const extensionsDir = process.env.FPU_VSIX_EXTENSIONS_DIR;
  assert.ok(
    extensionsDir,
    "the launcher names the extensions directory it installed the VSIX into",
  );
  const installed = fs
    .readdirSync(extensionsDir)
    .filter((name) => name.startsWith(`${EXTENSION_ID}-`));
  assert.strictEqual(
    installed.length,
    1,
    `the VSIX must be installed in ${extensionsDir}`,
  );
}

(trusted ? suite.skip : suite)("Untrusted workspace", () => {
  test("the workspace opens untrusted", () => {
    assert.strictEqual(vscode.workspace.isTrusted, false);
  });

  test("the installed extension is disabled and never activates", async () => {
    assertVsixInstalled();
    // A disabled extension is absent from the host's list rather than listed as inactive.
    assert.strictEqual(vscode.extensions.getExtension(EXTENSION_ID), undefined);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(!commands.includes(COMMAND));
  });
});

(trusted ? suite : suite.skip)("Trusted workspace, installed VSIX", () => {
  test("the workspace opens trusted", () => {
    assert.strictEqual(vscode.workspace.isTrusted, true);
  });

  test("the installed extension loads and activates", async () => {
    assertVsixInstalled();
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, "the installed VSIX is listed by the host");
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(COMMAND));
  });
});
