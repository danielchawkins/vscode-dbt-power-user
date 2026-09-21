# Cursor acquisition policy

Pinned-host smoke and local `just smoke-cursor` install Cursor from an immutable production URL, never from a developer profile and never from unofficial mirrors.

Unauthenticated Cursor renders all three local extension webviews; aiserver and repository-indexing authentication errors are background service noise, not a workbench gate. The harness passes `--skip-onboarding` and `--suppress-popups-on-startup` from the pinned build's own option schema, without credentials or seeded profile state. The ten-sample runtime benchmark runs in CI because macOS still activates the Cursor application during local automation.

## Official source

| Field                  | Value                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Resolve API            | `https://www.cursor.com/api/download?platform=darwin-arm64&releaseTrack=latest`            |
| Immutable archive host | `https://downloads.cursor.com/production/{commitSha}/darwin/arm64/Cursor-darwin-arm64.dmg` |
| Archive commit         | API `commitSha`; identifies the immutable download path                                    |
| Product commit         | `product.json` `commit`; verified separately because it may differ from the archive commit |
| Platform id (API)      | `darwin-arm64` (CI/macOS arm64 runners)                                                    |
| Recorded in repository | `scripts/smoke/pins.env`                                                                   |

The resolve API is used only when advancing the pin (`scripts/smoke/resolve-cursor-pin.sh`). CI and local smoke read the committed `FPU_CURSOR_DOWNLOAD_URL` and `FPU_CURSOR_SHA256`; they do not call `releaseTrack=latest` at runtime.

## Pin advance procedure

1. Run `bash scripts/smoke/resolve-cursor-pin.sh` on macOS with network access.
2. The script validates the resolved URL against the API's archive commit, downloads the DMG, records the separate `product.json` commit, verifies `vscodeVersion` matches `1.128.x`, computes SHA-256, and rewrites `scripts/smoke/pins.env`.
3. Confirm the new app's `out/cli.js` still declares `--skip-onboarding` and `--suppress-popups-on-startup`.
4. Commit the updated pin file. Re-run `just smoke-cursor` and the CI Cursor job before merging.

Calling `releaseTrack=<semver>` on the resolve API returned `Failed to fetch download link`, including for previously installed builds such as `3.20.14`. Historical DMGs may also return HTTP 403 from `downloads.cursor.com`. The supported pin path is therefore: resolve `latest` once, record `{version, commitSha, downloadUrl, sha256}`, and consume the immutable URL thereafter.

## Cache key

`${XDG_CACHE_HOME:-$HOME/Library/Caches}/fusion-power-user/hosts/cursor-{FPU_CURSOR_VERSION}-darwin-arm64/`, overridable with `FPU_HOST_CACHE`, keyed by host, product version, platform, and `pins.env`. The DMG exists only during fetch and is verified against `FPU_CURSOR_SHA256`.

## Integrity

`scripts/smoke/fetch-cursor.sh` downloads `FPU_CURSOR_DOWNLOAD_URL`, verifies SHA-256, mounts read-only, and copies `Cursor.app` into the cache with `ditto`. Failure to verify checksum fails the job; there is no skip path.

## Runtime metadata

`scripts/smoke/host-metadata.sh cursor` prints `FPU_HOST_METADATA` JSON with `productVersion`, the product commit, `vscodeVersion`, and `quality` from `product.json`, plus `FPU_SMOKE_RUNTIME` from the extension-host smoke test (`electron`, `chrome`, `node` via `process.versions`). Fetch scripts validate cached product metadata before reuse.
