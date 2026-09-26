#!/usr/bin/env bash
# Evidence runner. Usage:
#   DBT_BIN=/abs/path/to/dbt scripts/evidence/run.sh <experiment-name> [output-root]
# Copies scripts/evidence/fixture to a fresh project dir, sources experiments/<name>.sh, and records
# everything under <output-root>/<name>/ (default: $TMPDIR/fpu-evidence).
#
# Isolation: every recorded command runs under `env -i` with only HOME, PATH (node + DBT_BIN's dir + /usr/bin:/bin),
# TERM=dumb, DBT_ENGINE_PROFILES_DIR=<fixture>, DBT_ENGINE_SEND_ANONYMOUS_USAGE_STATS=false, and
# whatever the experiment passes with `with VAR=value ...`. Nothing else from the operator shell reaches dbt.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name="$1"
out_root="${2:-${TMPDIR:-/tmp}/fpu-evidence}"
: "${DBT_BIN:?set DBT_BIN to an absolute dbt executable path}"
[[ "$DBT_BIN" = /* && -x "$DBT_BIN" ]] || {
  echo "DBT_BIN must be an absolute executable path" >&2
  exit 2
}
node_bin="$(command -v node)"
out="$out_root/$name"
rm -rf "$out"
mkdir -p "$out/project"
out="$(cd "$out" && pwd -P)"
cp -R "$here/fixture/." "$out/project/"
project="$(cd "$out/project" && pwd -P)"
export EVIDENCE_OUT="$out" EVIDENCE_PROJECT="$project" EVIDENCE_HERE="$here"
clean_path="$(dirname "$node_bin"):$(dirname "$DBT_BIN"):/usr/bin:/bin"
base_env=(HOME="$HOME" PATH="$clean_path" TERM=dumb
  DBT_ENGINE_PROFILES_DIR="$project" DBT_ENGINE_SEND_ANONYMOUS_USAGE_STATS=false)
# Per-experiment extra env, set with `with`; applies to every later step until changed.
extra_env=()
with() { extra_env=("$@"); }
without() { extra_env=(); }

{
  echo "experiment: $name"
  echo "date_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "host: $(uname -srm)"
  echo "dbt_bin: $DBT_BIN"
  echo "dbt_version: $("$DBT_BIN" --version 2>&1 | head -1)"
  echo "dbt_sha256: $(shasum -a 256 "$DBT_BIN" | cut -d' ' -f1)"
  echo "node: $node_bin $("$node_bin" --version)"
  echo "project_dir: $project"
  echo "harness_revision: $(cd "$here" && jj log -r @ --no-graph -T 'change_id.short() ++ " " ++ commit_id.short()' 2> /dev/null || echo unknown)"
  echo "base_env: ${base_env[*]}"
} > "$out/context.txt"

step=0
now() { "$node_bin" -e 'process.stdout.write(new Date().toISOString())'; }
# dbtp <subcommand> <args...>: $DBT_BIN with --profiles-dir set to the fixture.
dbtp() {
  local sub="$1"
  shift
  "$DBT_BIN" "$sub" --profiles-dir "$project" "$@"
}
# record <label> <command...>: runs the command in $project under the clean env, captures everything.
# The first word may be `dbtp` (expanded here) or any executable; it never aborts the run.
record() {
  local label="$1"
  shift
  step=$((step + 1))
  local dir argv
  dir="$out/steps/$(printf '%02d' "$step")-$label"
  mkdir -p "$dir"
  if [[ "$1" == dbtp ]]; then
    argv=("$DBT_BIN" "$2" --profiles-dir "$project" ${3+"${@:3}"})
  else
    argv=("$@")
  fi
  local env_all=("${base_env[@]}" ${extra_env[@]+"${extra_env[@]}"})
  {
    echo "cwd: $project"
    printf 'argv:'
    printf ' %q' "${argv[@]}"
    echo
    echo "env:"
    printf '  %s\n' "${env_all[@]}"
  } > "$dir/command.txt"
  local started ended code
  started=$(now)
  set +e
  (cd "$project" && env -i "${env_all[@]}" "${argv[@]}") > "$dir/stdout.txt" 2> "$dir/stderr.txt"
  code=$?
  set -e
  ended=$(now)
  printf 'started: %s\nended: %s\nexit_code: %s\n' "$started" "$ended" "$code" >> "$dir/command.txt"
  snapshot "$dir"
  "$node_bin" -e '
    const [dir, cwd, started, ended, code, ...rest] = process.argv.slice(1);
    const split = rest.indexOf("--");
    require("fs").writeFileSync(dir + "/result.json", JSON.stringify({
      cwd, argv: rest.slice(0, split), env: rest.slice(split + 1), started, ended, exit_code: Number(code) }, null, 2));
  ' "$dir" "$project" "$started" "$ended" "$code" "${argv[@]}" -- "${env_all[@]}"
}
# snapshot <dir>: every file under target/ and logs/ (hidden dirs included) with mtime, size and sha256.
snapshot() {
  (cd "$project" && find target logs -type f 2> /dev/null | sort | while read -r f; do
    printf '%s %s %s %s\n' "$(stat -f '%Sm' -t '%Y-%m-%dT%H:%M:%S' "$f")" "$(stat -f '%z' "$f")" \
      "$(shasum -a 256 "$f" | cut -c1-12)" "$f"
  done) > "$1/files-after.txt" || true
}
# lsp <label> <steps.json> <dbt lsp args...>: one language-server session through lsp-session.mjs.
# steps.json is a path relative to scripts/evidence/steps/ or an absolute path.
lsp() {
  local label="$1" steps="$2"
  shift 2
  [[ "$steps" = /* ]] || steps="$here/steps/$steps"
  record "$label" "$node_bin" "$here/lsp-session.mjs" "$project" "$steps" \
    "$out/steps/$(printf '%02d' $((step + 1)))-$label" -- "$DBT_BIN" "$@"
}

# Every experiment starts from a warehouse that has the three source tables, and no target/ or logs/.
record setup-warehouse dbtp run-operation setup_raw
rm -rf "$project/target" "$project/logs"

# shellcheck source=scripts/evidence/lib.sh
source "$here/lib.sh"
# shellcheck source=/dev/null
source "$here/experiments/$name.sh"

# Keep Fusion's own logs.
if [[ -d "$project/logs" ]]; then cp -R "$project/logs" "$out/fusion-logs"; fi
echo "$out"
