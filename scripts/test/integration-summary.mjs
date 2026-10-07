// Prints the parity table for the shard logs `docker-integration.sh` collected. Usage:
//   node integration-summary.mjs <label,label,...> <shard log>...
// Exits 1 when any requested label failed or produced no result.
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  expectedCounts,
  formatSummary,
  judgeLabel,
  parseShardOutput,
} from "./integration-result.mjs";

const [labelList, ...logs] = process.argv.slice(2);
const dir = path.dirname(fileURLToPath(import.meta.url));
const expected = expectedCounts(
  JSON.parse(readFileSync(path.join(dir, "integration-expected.json"), "utf8")),
);
const runs = logs.flatMap((file) =>
  parseShardOutput(readFileSync(file, "utf8")),
);
const verdicts = labelList.split(",").map((label) => {
  const run = runs.find((r) => r.label === label) ?? {
    label,
    exitCode: 125,
    seconds: 0,
    log: "",
  };
  return judgeLabel(run, expected[label]);
});
console.log(formatSummary(verdicts));
process.exitCode = verdicts.every((v) => v.ok) ? 0 : 1;
