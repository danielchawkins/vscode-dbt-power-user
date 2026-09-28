import { glob } from "glob";
import Mocha from "mocha";
import * as path from "path";

/** Mocha entry for the untrusted launch, which runs outside test-cli and so needs its own runner. */
export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", timeout: 30_000, color: true });
  const files = await glob("*.test.js", { cwd: __dirname });
  for (const file of files) {
    mocha.addFile(path.resolve(__dirname, file));
  }
  return new Promise<void>((resolve, reject) => {
    mocha.run((failures) =>
      failures > 0
        ? reject(new Error(`${failures} test(s) failed.`))
        : resolve(),
    );
  });
}
