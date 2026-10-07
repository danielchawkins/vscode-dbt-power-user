#!/usr/bin/env bash
set -euo pipefail

# Packaged-VSIX smoke for both pinned hosts in Linux arm64 containers under Xvfb; no windows open on the host.
# usage: docker-smoke.sh <out-dir> [run-host-smoke.sh args, e.g. --fixture PATH]
smoke_root=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$smoke_root/../.." && pwd)
platform=linux/arm64
hosts=(vscode cursor)

out=${1:?usage: docker-smoke.sh <out-dir> [args...]}
shift
mkdir -p "$(dirname "$out")"
final=$(cd "$(dirname "$out")" && pwd)/$(basename "$out")

# The container writes to a staging directory inside the repository: Docker VMs such as Colima only share the home
# directory, so an arbitrary out path (/tmp/...) would not reach the host. It is copied to $final at the end.
mkdir -p "$repo/out"
out=$(mktemp -d "$repo/out/smoke-docker-stage.XXXXXX")
work=$(mktemp -d)
pids=()
names=()
image=""
cleanup() {
  if [[ ${#pids[@]} -gt 0 ]]; then kill "${pids[@]}" 2> /dev/null || true; fi
  if [[ ${#names[@]} -gt 0 ]]; then docker rm -f "${names[@]}" > /dev/null 2>&1 || true; fi
  # Files written by the container user belong to the host user again, whichever way the run ended.
  if [[ -n "$image" ]]; then
    docker run --rm --platform "$platform" --user 0 -v "$out:/out" "$image" \
      chown -R "$(id -u):$(id -g)" /out > /dev/null 2>&1 || true
  fi
  if [[ -d "$out" ]]; then
    rm -rf "$final"
    mkdir -p "$final"
    cp -R "$out/." "$final/"
    rm -rf "$out"
  fi
}
trap 'cleanup; exit 130' INT TERM
trap cleanup EXIT

# Same content-hash tag as scripts/test/docker-integration.sh, so the two share one base image.
base_hash=$(cd "$repo" && cat docker/integration/Dockerfile docker/integration/fetch-vscode.mjs \
  scripts/test/integration-layout.mjs mise.toml mise.lock package.json package-lock.json | shasum -a 256 | cut -c1-12)
base=fpu-integration:$base_hash
smoke_hash=$(cd "$repo" && {
  echo "$base_hash"
  cat docker/smoke/Dockerfile docker/smoke/Dockerfile.dockerignore scripts/smoke/pins.env scripts/smoke/common.sh \
    scripts/smoke/fetch-host.sh scripts/smoke/fetch-vscode.sh scripts/smoke/fetch-cursor.sh
} | shasum -a 256 | cut -c1-12)
smoke_image=fpu-smoke:$smoke_hash

# Build the images while the host packages once.
(
  docker build -q --platform "$platform" -t "$base" -f "$repo/docker/integration/Dockerfile" "$repo" &&
    docker build -q --platform "$platform" -t "$smoke_image" --build-arg "BASE=$base" \
      -f "$repo/docker/smoke/Dockerfile" "$repo"
) > "$work/image.log" 2>&1 &
image_pid=$!
(cd "$repo" && just package) > "$work/package.log" 2>&1 || {
  tail -40 "$work/package.log" >&2
  echo "docker-smoke: just package failed" >&2
  exit 1
}
wait "$image_pid" || {
  cat "$work/image.log" >&2
  echo "docker-smoke: image build failed" >&2
  exit 1
}
image=$smoke_image

vsix=$(realpath "$(cat "$repo/out/latest-vsix")")
echo "FPU_SMOKE_VSIX=$vsix sha256=$(shasum -a 256 "$vsix" | awk '{print $1}')"

# The container user is not the host user, so it needs write access to the mounted out directory.
chmod 777 "$out"

# Each container copies the repo into its own /work, keeping the image's node_modules, and smokes with the
# VSIX mounted read-only. The script runs in the container, so its variables must not expand here.
# shellcheck disable=SC2016
container_script='
  tar -C /src --exclude=./node_modules --exclude=./.vscode-test --exclude=./.jj --exclude=./.git \
    --exclude=./.cache --exclude=./out --exclude=./dist --exclude=./*.vsix -cf - . | tar -C /work -xf -
  cd /work
  mkdir -p out
  exec bash scripts/smoke/run-host-smoke.sh --host "$FPU_SMOKE_HOST" --vsix /vsix/smoke.vsix "$@"
'

for host in "${hosts[@]}"; do
  name="fpu-smoke-$smoke_hash-$host-$$"
  names+=("$name")
  mkdir -p "$out/$host"
  # The default seccomp profile blocks the user namespaces Chromium's sandbox needs as a non-root user.
  # Separate containers have separate network namespaces, so neither needs its own FPU_CDP_PORT.
  docker run --rm --init --name "$name" --platform "$platform" --security-opt seccomp=unconfined --shm-size=1g \
    -v "$repo:/src:ro" -v "$vsix:/vsix/smoke.vsix:ro" -v "$out:/out" \
    -e FPU_SMOKE_HOST="$host" -e FPU_SMOKE_SCREENSHOTS=/out \
    ${FPU_SMOKE_REQUIRE_FUSION:+-e FPU_SMOKE_REQUIRE_FUSION="$FPU_SMOKE_REQUIRE_FUSION"} \
    "$smoke_image" bash -euc "$container_script" bash "$@" > "$work/$host.log" 2>&1 &
  pids+=("$!")
done

status=0
for i in "${!hosts[@]}"; do
  host_status=0
  wait "${pids[$i]}" || host_status=$?
  if [[ "$host_status" -eq 0 ]]; then
    echo "docker-smoke: ${hosts[$i]} ok"
  else
    echo "docker-smoke: ${hosts[$i]} FAILED (exit $host_status)" >&2
    tail -60 "$work/${hosts[$i]}.log" >&2
    status=1
  fi
done
pids=()
if [[ "$status" -ne 0 ]]; then
  echo "docker-smoke: FAIL (full logs in $work)" >&2
  exit 1
fi
echo "$(shasum -a 256 "$vsix" | awk '{print $1}')  $vsix" > "$out/vsix.sha256"
cat "$work"/*.log | grep -E 'FPU_HOST_METADATA|passing|failing' || true
echo "docker-smoke: evidence in $final/<host>/<fixture>/index.json"
rm -rf "$work"
