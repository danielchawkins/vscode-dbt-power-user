import { runTests } from "@vscode/test-electron";
import * as path from "path";
import { fixturePath, getExtensionRoot } from "./helpers/testFixtures";

async function main() {
  try {
    const extensionDevelopmentPath = getExtensionRoot();
    const extensionTestsPath = path.resolve(__dirname, "./index.js");

    await runTests({
      version: "1.128.0",
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [fixturePath("single-project"), "--disable-extensions"],
      // Forward PATH, SQLFMT_PATH, and other environment variables to the
      // extension host process so that dbt, sqlfmt, and other tools are
      // discoverable. macOS Electron apps often reset PATH to system defaults.
      extensionTestsEnv: {
        PATH: process.env.PATH,
        SQLFMT_PATH: process.env.SQLFMT_PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
      },
    });
  } catch (err) {
    console.error("Failed to run integration tests:", err);
    process.exit(1);
  }
}

main();
