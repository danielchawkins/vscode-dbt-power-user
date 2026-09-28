# shellcheck shell=bash
# Sourced by scripts/evidence/run.sh, which defines record, lsp, dbtp and EVIDENCE_*.
# D4: does `dbt lsp` register file watching with the client? Sessions: initialize (`client-watch`: the
# didChangeWatchedFiles capabilities vscode-languageclient sends, dynamicRegistration and relativePatternSupport;
# `baseline`: dynamicRegistration only; `caps-no-dynreg`: neither), initialized, didOpen of order_totals.sql,
# wait for Analyzing to end. Each session is followed by a step that prints every server→client request and every
# registration it carried. HOME is a fresh dir under the output root.
# Decision rule, fixed before running: if a `client/registerCapability` registers `workspace/didChangeWatchedFiles`
# with watchers covering the project's model SQL and YAML files, the extension forwards no file events to the
# language server; otherwise the client's `synchronize.fileEvents` carries them per project. Either way the
# FusionProjectIntegration watchers that trigger the manifest rebuild are outside this rule.
mkdir -p "$EVIDENCE_OUT/home"
with FUSION_POWER_USER_SCHEMA_ORIGIN=local HOME="$EVIDENCE_OUT/home"
# registrations <label>: server→client requests and registerCapability params from the previous lsp step.
registrations() {
  local transcript
  transcript="$(printf '%s\n' "$EVIDENCE_OUT"/steps/*-"$1"/lsp-transcript.jsonl)"
  # shellcheck disable=SC2016
  record "$1-server-requests" node -e '
    const lines = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    for (const { t, dir, msg } of lines) {
      if (dir !== "server->client" || msg.id === undefined || !msg.method) continue;
      const regs = msg.method === "client/registerCapability" ? " " + JSON.stringify(msg.params) : "";
      console.log(`${t} ${msg.method}${regs}`);
    }
  ' "$transcript"
}
for v in caps-client-watch baseline caps-no-dynreg; do
  reset_target
  lsp "lsp-$v" "protocol/init-$v.json" \
    --project-dir "$EVIDENCE_PROJECT" --profiles-dir "$EVIDENCE_PROJECT" --lint-enabled false \
    --static-analysis strict --no-version-check --command-prefix "" \
    --log-level-file trace --otel-file-name "d4-$v-otel.jsonl"
  registrations "lsp-$v"
done
