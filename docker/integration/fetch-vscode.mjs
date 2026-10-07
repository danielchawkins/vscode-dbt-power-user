// Downloads the pinned VS Code into the directory the integration runner searches (.vscode-test under /work).
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { VSCODE_VERSION } from "../../scripts/test/integration-layout.mjs";

const executable = await downloadAndUnzipVSCode({
  version: VSCODE_VERSION,
  cachePath: "/work/.vscode-test",
});
console.log(executable);
