#!/bin/sh
# Run integration labels in Linux arm64 containers. Usage: docker-integration.sh [label]
# With no label, runs every label as parallel shards; see DOCKER_SHARDS in integration-layout.mjs.
set -eu

repo=$(cd "$(dirname "$0")/../.." && pwd)
scripts="$repo/scripts/test"
platform=linux/arm64

shards=$(node "$scripts/integration-shards.mjs" "${1:-}")
labels=$(printf '%s\n' "$shards" | tr ' ' '\n' | paste -sd, -)

# The tag is a content hash of everything the image is built from,
# so workspaces with different inputs never share one.
hash=$(cd "$repo" && cat docker/integration/Dockerfile docker/integration/fetch-vscode.mjs \
  scripts/test/integration-layout.mjs mise.toml mise.lock package.json package-lock.json | shasum -a 256 | cut -c1-12)
image=fpu-integration:$hash

work=$(mktemp -d)
pids=
names=
cleanup() {
  # shellcheck disable=SC2086
  [ -z "$pids" ] || kill $pids 2> /dev/null || true
  # A client killed before its container started, or by SIGKILL, leaves the container behind.
  if [ -n "$names" ]; then
    # shellcheck disable=SC2086
    docker rm -f $names > /dev/null 2>&1 || true
  fi
}
trap 'cleanup; exit 130' INT TERM

# Build the image while the host compiles and packages once; shards share the results read-only.
docker build -q --platform "$platform" -t "$image" -f "$repo/docker/integration/Dockerfile" "$repo" \
  > "$work/image.log" 2>&1 &
image_pid=$!
(cd "$repo" && just build-integration) > "$work/build.log" 2>&1 || {
  tail -40 "$work/build.log" >&2
  echo "docker-integration: host build failed" >&2
  exit 1
}
wait "$image_pid" || {
  cat "$work/image.log" >&2
  echo "docker-integration: image build failed" >&2
  exit 1
}

# Each shard copies the repo into its own /work, so no two shards write to the same directory.
# The copy keeps the host-built out/, dist/ and VSIX; the image supplies node_modules and VS Code.
# The script runs in the container, so its variables must not expand here.
# shellcheck disable=SC2016
shard_script='
  tar -C /src --exclude=./node_modules --exclude=./.vscode-test --exclude=./.jj --exclude=./.git --exclude=./.cache \
    -cf - . | tar -C /work -xf -
  cd /work
  # The recorded VSIX path is the host path.
  set -- /work/*.vsix
  echo "$1" > out/latest-vsix
  for label in $FPU_LABELS; do
    echo "FPU-LABEL-BEGIN $label"
    start=$(date +%s)
    status=0
    xvfb-run -a npm run test:integration -- --label "$label" 2>&1 || status=$?
    echo
    echo "FPU-LABEL-END $label $status $(($(date +%s) - start))"
  done
'

index=0
for shard in $(printf '%s\n' "$shards" | tr ' ' ','); do
  index=$((index + 1))
  name="fpu-int-$hash-$index-$$"
  names="$names $name"
  # Docker's default seccomp profile blocks the user namespaces Chromium's sandbox needs as a non-root user.
  docker run --rm --init --name "$name" --platform "$platform" --security-opt seccomp=unconfined \
    -v "$repo:/src:ro" \
    -e FPU_LABELS="$(echo "$shard" | tr ',' ' ')" \
    "$image" sh -euc "$shard_script" > "$work/shard-$index.log" 2>&1 &
  pids="$pids $!"
done
# shellcheck disable=SC2086
wait $pids || true
pids=

status=0
node "$scripts/integration-summary.mjs" "$labels" "$work"/shard-*.log || status=$?
if [ "$status" -ne 0 ]; then
  for log in "$work"/shard-*.log; do
    echo "--- $log (tail)" >&2
    tail -60 "$log" >&2
  done
  echo "docker-integration: FAIL (full logs in $work)" >&2
  exit 1
fi
rm -rf "$work"
