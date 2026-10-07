// Prints the shards `docker-integration.sh` runs, one line of space-separated labels per shard.
// With a label argument, prints that label alone; an unknown label exits 2.
import { DOCKER_SHARDS, LABELS, VSIX_LABELS } from "./integration-layout.mjs";

const [label] = process.argv.slice(2);
if (!label) {
  console.log(DOCKER_SHARDS.map((shard) => shard.join(" ")).join("\n"));
} else if ([...LABELS, ...VSIX_LABELS].includes(label)) {
  console.log(label);
} else {
  console.error(`unknown label: ${label}`);
  process.exitCode = 2;
}
