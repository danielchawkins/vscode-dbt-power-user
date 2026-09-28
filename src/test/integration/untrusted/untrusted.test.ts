import * as assert from "assert";
import * as vscode from "vscode";

suite("Untrusted workspace", () => {
  test("the workspace opens untrusted", () => {
    assert.strictEqual(vscode.workspace.isTrusted, false);
  });

  test.skip("extension stays inactive in an untrusted workspace", () => {});
});
