// Checks that every tool-environment fixture passed on each named host.
// usage: check-tool-env-evidence.mjs <dir> <host>...
// Each host needs <dir>/<host>/tool-env-<name>/toolEnvironment.json with passed: true for every table entry.
// Extra or partial tool-env-* directories fail too.
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { TOOL_ENV_FIXTURES } from "./toolEnvFixtures.mjs";

const [dir, ...hosts] = process.argv.slice(2);
if (!dir || hosts.length === 0) {
  console.error("usage: check-tool-env-evidence.mjs <dir> <host>...");
  process.exit(2);
}

const expected = TOOL_ENV_FIXTURES.map((entry) => `tool-env-${entry.name}`);
const problems = [];

for (const host of hosts) {
  const hostDir = path.join(dir, host);
  for (const name of expected) {
    const evidence = path.join(hostDir, name, "toolEnvironment.json");
    if (!existsSync(evidence)) {
      problems.push(`${host}: missing ${name}/toolEnvironment.json`);
      continue;
    }
    let report;
    try {
      report = JSON.parse(readFileSync(evidence, "utf-8"));
    } catch (error) {
      problems.push(
        `${host}: ${name}/toolEnvironment.json is not JSON (${error.message})`,
      );
      continue;
    }
    if (report.fixture !== name || report.passed !== true) {
      problems.push(
        `${host}: ${name} did not pass (${JSON.stringify(report)})`,
      );
    }
  }
  const present = existsSync(hostDir) ? readdirSync(hostDir) : [];
  for (const name of present.filter((entry) => entry.startsWith("tool-env-"))) {
    if (!expected.includes(name)) {
      problems.push(`${host}: unexpected ${name}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Tool-environment evidence failed for ${hosts.join(", ")}:`);
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}
console.log(
  `Tool-environment evidence passed: ${expected.length} fixtures on ${hosts.join(", ")}`,
);
