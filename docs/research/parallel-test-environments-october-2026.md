# Research

## Question

How should this repo run its VS Code / Cursor integration and smoke suites in prebuilt, fully configured containers or VMs, ideally several in parallel on one Apple-silicon Mac (18 cores, 64 GB)? Answer each part:

1. **macOS options.** Can a macOS guest image run headless VS Code and Cursor for these tests, and is it faster or more faithful than Linux? Consider Tart, Apple Virtualization.framework, Lima with vz, and Anka. Report:
   - licensing: macOS allows 2 concurrent VMs per host;
   - image size and boot time;
   - whether GUI apps can run headless (Cursor and VS Code need a window server);
   - the CDP access the smoke test uses.
     Docker cannot run macOS containers. Confirm that.
2. **Linux options.** Do VS Code and Cursor run on Linux arm64 under Xvfb in Docker? This machine runs Colima (aarch64, 6 CPU, 16 GiB). Cover:
   - `@vscode/test-electron` on linux-arm64;
   - Cursor's Linux arm64 build (AppImage? `.deb`?);
   - the dbt Fusion 2.0.6 Linux arm64 binary;
   - whether this repo's smoke test assumes macOS, for example a `sample` binary, `darwin` paths, or `.app` bundles.
     Cite the files.
3. **Parallelism inside the repo today.** Is there any shared state that would prevent running labels or suites concurrently? Check the heavy lock `/tmp/fpu-heavy.lock`, fixed CDP ports, shared `.vscode-test` caches, and the `user-data-dir` and extensions-dir handling in `scripts/test/run-integration.mjs`, `.vscode-test.mjs` and `scripts/smoke/`.
4. **A recommended design.** Give:
   - a Dockerfile outline with base image, Node 24, mise or pinned tools, Xvfb, VS Code and Cursor pinned versions, and dbt Fusion 2.0.6;
   - how the repo and VSIX get mounted;
   - how to fan out labels across N containers;
   - expected wall time against today's sequential run;
   - what parity we lose against macOS: the CI smoke jobs run on macOS runners, `.github/workflows/check-and-package.yml`.

Ground every claim about this repo in a file with a line. For external facts, give the source URL.

## Recommendation

Use two environments: Linux containers for the integration suite, and macOS for smoke. Move `just test-integration` into Linux arm64 Docker containers on Colima, one private worktree per shard. Use debian bookworm with Xvfb, the mise-locked Node 24.21.0 and the Fusion 2.0.6 glibc build (add its linux-arm64 checksum to mise.lock first), and npm ci. Bake VS Code 1.128.0 into the same fixed /work/.vscode-test that the copied tree runs from. Pass a VSIX packaged once on the host, read-only, through out/latest-vsix. Before scaling out, change run-integration.mjs so it prepares only the selected labels. Then pilot a single label under `xvfb-run -a` to prove that Electron, the dbt spy and Fusion all work on aarch64. Only after that, grow to 3-4 label groups within Colima's current 6 CPU / 16 GiB, or resize Colima and measure. Moving integration costs no CI parity, because CI never runs it. Keep both smoke suites on macOS, because their scripts gate on Darwin-arm64 and assume .app/.dmg. For parallel smoke, run smoke-vscode and smoke-cursor at the same time in two separate macOS worktrees (or git worktrees), each with --vsix. benchmark-runtime compiles into out/ unconditionally, so they must not share a checkout. Give each run a distinct FPU_CDP_PORT range. Add Tart guests (at most two) only if host-level isolation is not enough. Tart costs a ~25 GB image and needs a provisioned auto-login GUI session and an unlocked keychain. Treat a Linux smoke port as optional extra coverage that needs its own Cursor pin and fetch code, never as a substitute for the macOS smoke CI jobs. Measure wall time before relying on any estimate.

## Points

| Point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Verdict    | Confidence  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------- |
| 1. The smoke suites cannot run on Linux today. scripts/smoke/common.sh:10-13 exits unless the machine is Darwin-arm64. pins.env:3 and pins.env:11 pin darwin-arm64 hosts, and pins.env:13 pins a Cursor .dmg. host_executable, host_cli and host_product_json (common.sh:42-84) all point inside `.app/Contents`. attach_dmg calls hdiutil (common.sh:29-31). The host cache defaults to ~/Library/Caches (common.sh:5), and CI caches that same path (ci.yml:37). Porting smoke to Linux means writing a Linux pin set, a fetch and extract path, and Linux path functions. It is a code project, not just an image.                                                                                                                                                                                                                                                                                                                                                                                                                                 | thesis     | high        |
| 2. run-smoke.mjs has few macOS assumptions of its own. The `sample` call is guarded by process.platform === 'darwin' (line 163). The `.app` slice at line 155 only filters which processes the watchdog reports. CDP is a launch flag, `--remote-debugging-port` (line 181). The port comes from FPU_CDP_PORT or from a probe that starts at 10000 + pid % 20000 (lines 105-107). A probe is not a reservation, and measure-runtime.mjs sets FPU_CDP_PORT explicitly for each iteration. Containers have separate network namespaces, so ports cannot collide between containers. Two runs on the same Mac (host or one guest) can still collide if both get the same FPU_CDP_PORT. The suite also needs a real painting window: line 182 says an occluded window paints nothing. On Linux that means an Xvfb display. On macOS it means a logged-in GUI session, which matters for a headless Tart guest. CDP alone does not make the suite headless.                                                                                                | middle     | high        |
| 3. The integration suite has no platform gate. It downloads VS Code 1.128.0 through test-electron (run-integration.mjs:198, integration-layout.mjs:13), and test-electron picks linux-arm64 by default on an arm64 Linux machine. Microsoft documents that VS Code needs Xvfb on headless Linux and gives the apt package list. The runner starts node_modules/.bin/vscode-test directly (run-integration.mjs:118), so the container must wrap the whole command in `xvfb-run -a` or set DISPLAY. Linux viability is plausible but not demonstrated. Nobody has run Electron, the dbt spy wrapper and Fusion together under Xvfb on aarch64, so a one-label pilot has to prove it.                                                                                                                                                                                                                                                                                                                                                                    | middle     | medium      |
| 4. Cursor publishes a Linux arm64 AppImage. Today's download API returned Cursor-3.23.23-aarch64.AppImage. The repo pins 3.21.16 with a darwin archive commit and a sha256 (pins.env:8-14). I have not confirmed a pinned Linux arm64 3.21.16 artifact, its checksum, or whether its product.json matches the darwin one. Until those are recorded, a Cursor container is not a pinned host. I did not check whether a .deb exists or whether the AppImage needs FUSE.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | middle     | medium      |
| 5. The repo already settles the Fusion question. mise.lock pins 2.0.6 for linux-arm64 as the glibc tarball fs-v2.0.6-aarch64-unknown-linux-gnu, and it also has a musl variant. A Debian image should use the glibc artifact. The runner finds dbt through FPU_INTEGRATION_DBT_PATH (absolute) or `which dbt`, and AGENTS.md requires tests to find it through configuration or PATH. So a Fusion binary from `mise install --locked` on PATH, or set through FPU_INTEGRATION_DBT_PATH, is enough. One caveat is new: the linux-arm64 Fusion entry has no checksum, while the macos-arm64 entry does (mise.lock:39-53).                                                                                                                                                                                                                                                                                                                                                                                                                               | antithesis | high        |
| 6. Profiles are isolated per run. Integration creates a mkdtemp root under realpath(tmpdir), and each label gets its own `u` (user-data) and `x` (extensions) dirs, passed as --user-data-dir and --extensions-dir. Smoke creates mkdtemp user-data, extensions and workspace dirs on every run. Repository-relative outputs are not isolated. run-smoke.mjs always copies out/package.json (lines 65-68), even with FPU_SKIP_INTEGRATION_COMPILE=1. The VSIX launch writes out/test/integration/untrusted/package.json. The pinned-host cache is shared under ~/Library/Caches by default. So 'two concurrent runs share nothing' holds only for profiles, not for the checkout.                                                                                                                                                                                                                                                                                                                                                                     | middle     | high        |
| 7. The shared working copy is what makes concurrent runs unsafe. `just test-integration` runs `just clean`, `just package`, a dev build, compile:integration and a copy into out/package.json (justfile:208-214). `just package` deletes every *.vsix and out/latest-vsix, then rewrites out/latest-vsix (justfile:284-306). Each concurrent run therefore needs its own writable worktree, including node_modules and out/. The copy must be made before any mutating command. I found no reference to /tmp/fpu-heavy.lock in the justfile, AGENTS.md, run-integration.mjs, .vscode-test.mjs, measure-runtime.mjs, ci.yml or the smoke scripts I read. That search did not cover the whole repo, and the lock may live in user-level hooks or agent tooling.                                                                                                                                                                                                                                                                                         | middle     | medium      |
| 8. The suite has 5 CLI labels and 2 VSIX labels. `--label` filters which labels launch (run-integration.mjs:39-44). prepareLabel still runs for all 7 labels on every invocation (lines 113-115), and the VSIX labels run one after another (lines 129-133). The CLI labels all go to one vscode-test invocation, which runs them in sequence. Sharding 7 ways without a fix repeats all fixture and dbt setup 7 times. Preparing only the selected labels should come before fan-out. It is a small diff but changes behaviour, so it needs a test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | thesis     | high        |
| 9. A macOS guest is the faithful way to isolate smoke runs. It runs the pinned darwin .app and the hdiutil/ditto fetch unchanged. It is not a speed win. Tart says it uses the same technology as Anka 3.0 and expects no real performance difference, but that is the vendor's claim, not a benchmark. The Tart quick-start image is a 25 GB download. That figure is not the on-disk size of a configured clone, and I found no measured boot time. A blog, not Apple, reports the 2-VM limit; I could not quote Apple's licence text. Running headless needs an unlocked login keychain on macOS 15+ hosts, and an auto-login GUI session in the guest, because VS Code and Cursor need a window server. Lima's macOS-guest support is experimental. At most two guests means isolation, not more parallelism than running both hosts directly on the Mac.                                                                                                                                                                                         | middle     | medium      |
| 10. Confirmed: Docker on Colima cannot run macOS containers. Containers depend on Linux kernel namespaces and cgroups, so every container on a Mac is a Linux container inside a Linux VM. Isolating macOS needs a full VM. Tart, or the commercial Anka, are the practical options. Lima with vz is mature for Linux guests, but its macOS guests are experimental, so it should not be the primary route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | middle     | medium      |
| 11. CI never runs `just test-integration`. check-and-package.yml runs `just check`, `just package` and a checksum on macos-latest. Smoke CI does compile the integration output (measure-runtime.mjs:26), but compiling is not running the suite. So moving integration to Linux costs no CI parity. Integration does lose fidelity to what macOS users get, which the 30-45 minute local gate covers today. Smoke CI is heavier than one run per host: each host runs benchmark-runtime with 10 sequential smoke iterations, then a separate multi-root smoke with FPU_SMOKE_REQUIRE_FUSION=1. The macOS socket-path limit is documented in the repo. Other losses are inferred, not demonstrated: realpath /private/var, APFS case-insensitivity, fonts and rendering in smoke-visual PNGs, and `sample` diagnostics.                                                                                                                                                                                                                               | middle     | medium      |
| 12. Dockerfile outline, untested. Base: debian:bookworm-slim on arm64. Packages: xvfb, xauth, libasound2, libgbm1, libgtk-3-0, libnss3, python3, perl (for shasum), unzip, git, curl, fonts. Install mise and run `mise install --locked`. That gives Node 24.21.0 and Fusion 2.0.6 glibc from mise.lock; add a linux-arm64 checksum for Fusion first. Run `npm ci` in a layer keyed on package-lock. Caching VS Code needs care: test-electron's default cache is `.vscode-test` under process.cwd(), and the runner passes no cachePath. Bake VS Code 1.128.0 into `/work/.vscode-test` and copy each shard's tree into that same /work, excluding .vscode-test. Or mount a shared volume at <worktree>/.vscode-test. A cache in any other directory is never found. Set FPU_INTEGRATION_DBT_PATH to the image's Fusion binary. Mount the repo read-only and rsync it into /work before any just/npm command. Mount the VSIX read-only and write its path into out/latest-vsix. Leave Cursor out of the image until a pinned Linux artifact exists. | middle     | low         |
| 13. The thesis's fan-out plan has two defects. First, measure-runtime.mjs runs compile:integration unconditionally in the checkout, so FPU_SKIP_INTEGRATION_COMPILE does not protect it. Running the two benchmark-runtime hosts at once in one checkout races on out/. Each host therefore needs its own worktree. Second, Colima is 6 CPU / 16 GiB today, so expect about 2-3 Electron+Fusion shards until Colima is resized and measured. A workable plan: package once on the host. Fix prepareLabel. Run integration shards in Linux containers, about 3-4 groups, not 7. At the same time, run smoke-vscode and smoke-cursor in two private macOS worktrees with --vsix. The best-case wall time is `just check` plus max(slowest shard, slower host smoke). Any minute figure is unmeasured; the thesis's 12-18 minutes is a guess.                                                                                                                                                                                                            | antithesis | speculative |
| 14. In mise.lock, the Fusion 2.0.6 linux-arm64 entry has only a URL. The macos-arm64 entry has a sha256, and so do the node and dprint linux entries. A Linux image built with `mise install --locked` therefore gets the right version of Fusion, but the download is not integrity-checked the way it is on macOS. Regenerate the lock with linux-arm64 checksums, for example by running `mise lock` for that platform, before treating the container as fully pinned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | new        | high        |

## Detail

### 1. The smoke suites cannot run on Linux today. scripts/smoke/common.sh:10-13 exits unless the machine is Darwin-arm64. pins.env:3 and pins.env:11 pin darwin-arm64 hosts, and pins.env:13 pins a Cursor .dmg. host_executable, host_cli and host_product_json (common.sh:42-84) all point inside `.app/Contents`. attach_dmg calls hdiutil (common.sh:29-31). The host cache defaults to ~/Library/Caches (common.sh:5), and CI caches that same path (ci.yml:37). Porting smoke to Linux means writing a Linux pin set, a fetch and extract path, and Linux path functions. It is a code project, not just an image

Verdict: thesis. Confidence: high.

I read common.sh, pins.env and ci.yml myself, and every quoted line is there. The antithesis's point-1 attack is aimed at the thesis summary ('CI never runs integration'), not at this point. I deal with it under point 11.

Citations:

- [r1a](../../scripts/smoke/common.sh): "if [[ "$(uname -s)-$(uname -m)" != "Darwin-arm64" ]]; then"
- [r1b](../../scripts/smoke/common.sh): "echo "$(cursor_app_dir)/Contents/MacOS/Cursor""
- [r1c](../../scripts/smoke/common.sh): "hdiutil attach -nobrowse -readonly "$1" |"
- [r1d](../../scripts/smoke/pins.env): "FPU_VSCODE_PLATFORM=darwin-arm64"
- [r1e](../../.github/workflows/ci.yml): "path: ~/Library/Caches/fusion-power-user/hosts"

Thesis (high): Smoke cannot run in Linux today. common.sh:10-13 exits unless `uname` reports Darwin-arm64. pins.env pins the darwin-arm64 VS Code and a darwin `.dmg` for Cursor. common.sh:46,49 look for executables inside `.app/Contents/MacOS`. fetch-cursor.sh:47-56 unpacks with hdiutil and ditto, which exist only on macOS. The host cache defaults to `$HOME/Library/Caches` (common.sh:5), and CI caches that same path. Linux smoke would need three things: a linux-arm64 pin set, a Linux fetch path, and a Linux branch in host_executable, host_cli and host_product_json.

Thesis citations:

- [c1a](../../scripts/smoke/common.sh): "if [[ "$(uname -s)-$(uname -m)" != "Darwin-arm64" ]]; then"
- [c1b](../../scripts/smoke/common.sh): "echo "Pinned host smoke requires Darwin arm64" >&2"
- [c1c](../../scripts/smoke/pins.env): "FPU_CURSOR_DOWNLOAD_URL=<https://downloads.cursor.com/production/8ae78e8eee1e63479c7e0504b664bc0a80c6800f/darwin/arm64/Cursor-darwin-arm64.dmg>"
- [c1d](../../scripts/smoke/common.sh): "echo "$(cursor_app_dir)/Contents/MacOS/Cursor""
- [c1e](../../scripts/smoke/fetch-cursor.sh): "ditto "$app_src" "$dest/Cursor.app""
- [c1f](../../scripts/smoke/common.sh): "cache_root=${FPU_HOST_CACHE:-${XDG_CACHE_HOME:-$HOME/Library/Caches}/fusion-power-user/hosts}"
- [c1g](../../.github/workflows/ci.yml): "path: ~/Library/Caches/fusion-power-user/hosts"

Antithesis: [high] “Nothing in that suite is macOS-only” is not demonstrated. The runner is portable-looking, but the proposed move has not been executed under Linux/Xvfb, so it does not establish that the actual Electron launch, native Fusion binary, extension packaging, and test assertions work there.

Antithesis: [high] The claim that CI never runs integration conflates the named `test-integration` recipe with compilation of integration output: smoke jobs do compile that output.

Antithesis: [high] The workflow evidence shows no `just test-integration`, but it does not show that integration compilation is absent from CI.

Counter-evidence:

- [a1](../../scripts/benchmark/measure-runtime.mjs): "const compile = spawnSync("npm", ["run", "compile:integration"], { cwd: root, stdio: "inherit", });"
- [a2](../../.github/workflows/ci.yml): "- name: Smoke VS Code 1.128.x run: | just benchmark-runtime-vscode fusion-power-user-*.vsix"

### 2. run-smoke.mjs has few macOS assumptions of its own. The `sample` call is guarded by process.platform === 'darwin' (line 163). The `.app` slice at line 155 only filters which processes the watchdog reports. CDP is a launch flag, `--remote-debugging-port` (line 181). The port comes from FPU_CDP_PORT or from a probe that starts at 10000 + pid % 20000 (lines 105-107). A probe is not a reservation, and measure-runtime.mjs sets FPU_CDP_PORT explicitly for each iteration. Containers have separate network namespaces, so ports cannot collide between containers. Two runs on the same Mac (host or one guest) can still collide if both get the same FPU_CDP_PORT. The suite also needs a real painting window: line 182 says an occluded window paints nothing. On Linux that means an Xvfb display. On macOS it means a logged-in GUI session, which matters for a headless Tart guest. CDP alone does not make the suite headless

Verdict: middle. Confidence: high.

I confirmed both sides in the code. The thesis is right about the runner itself. The antithesis is right that the shell wrapper gates hard on Darwin (point 1) and that a display is required, not optional. 'Mild' holds only for run-smoke.mjs.

Citations:

- [r2a](../../scripts/smoke/run-smoke.mjs): "for (const [pid, , cpu] of process.platform === "darwin" ? busiest : []) {"
- [r2b](../../scripts/smoke/run-smoke.mjs): "String(await findAvailablePort(10_000 + (process.pid % 20_000)));"
- [r2c](../../scripts/smoke/run-smoke.mjs): "// A covered or unfocused window otherwise reports hidden and paints nothing until it is raised."
- [r2d](../../scripts/benchmark/measure-runtime.mjs): "FPU_CDP_PORT: String(port),"

Thesis (high): The smoke runner itself has only mild macOS assumptions, and they are already guarded. The `sample` stack dump on watchdog timeout runs only when process.platform is darwin (run-smoke.mjs:163). The `.app` slice at run-smoke.mjs:155 only affects which processes the watchdog reports. On Linux, the image also needs python3 (host-metadata.sh:16) and `shasum` (run-host-smoke.sh:76). CDP access is just a launch flag, `--remote-debugging-port=<port>`. The port comes from FPU_CDP_PORT, or from a free-port probe that starts at 10000 + pid % 20000 (run-smoke.mjs:105-107,181). Each container has its own network namespace, so ports cannot collide between containers.

Thesis citations:

- [c2a](../../scripts/smoke/run-smoke.mjs): "for (const [pid, , cpu] of process.platform === "darwin" ? busiest : []) {"
- [c2b](../../scripts/smoke/run-smoke.mjs): "const bundle = hostApp.slice(0, hostApp.indexOf(".app") + 4);"
- [c2c](../../scripts/smoke/run-smoke.mjs): "String(await findAvailablePort(10_000 + (process.pid % 20_000)));"
- [c2d](../../scripts/smoke/run-smoke.mjs): "`--remote-debugging-port=${cdpPort}`,"
- [c2e](../../scripts/smoke/host-metadata.sh): "python3 - "$cli" "$product" "$host" << 'PY'"

Antithesis: [high] Calling the runner’s macOS assumptions “mild” is misleading. It hard-rejects Linux before any host download or test launch, and its executable, CLI, and product metadata paths are all macOS bundle paths.

Antithesis: [medium] “Ports cannot collide between containers” ignores the documented override. If the parent environment supplies the same `FPU_CDP_PORT`, each container can be internally consistent, but two processes in one network namespace will conflict; the free-port probe is also not a reservation retained through Electron startup.

Antithesis: [high] A visible/window-capable environment matters to this smoke test, not merely CDP. The code explicitly compensates for covered or unfocused windows that otherwise paint nothing.

Antithesis: [high] A `--remote-debugging-port` launch flag proves only that Electron is asked to expose CDP; it does not prove that the suite is headless-safe without a functional display server/window session.

Counter-evidence:

- [a3](../../scripts/smoke/common.sh): "if [[ "$(uname -s)-$(uname -m)" != "Darwin-arm64" ]]; then echo "Pinned host smoke requires Darwin arm64" >&2 exit 1 fi"
- [a4](../../scripts/smoke/common.sh): "echo "$(vscode_app_dir)/Contents/MacOS/Electron""
- [a5](../../scripts/smoke/run-smoke.mjs): "const cdpPort = process.env.FPU_CDP_PORT ?? String(await findAvailablePort(10_000 + (process.pid % 20_000)));"
- [a6](../../scripts/smoke/run-smoke.mjs): "// A covered or unfocused window otherwise reports hidden and paints nothing until it is raised. "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding","

### 3. The integration suite has no platform gate. It downloads VS Code 1.128.0 through test-electron (run-integration.mjs:198, integration-layout.mjs:13), and test-electron picks linux-arm64 by default on an arm64 Linux machine. Microsoft documents that VS Code needs Xvfb on headless Linux and gives the apt package list. The runner starts node_modules/.bin/vscode-test directly (run-integration.mjs:118), so the container must wrap the whole command in `xvfb-run -a` or set DISPLAY. Linux viability is plausible but not demonstrated. Nobody has run Electron, the dbt spy wrapper and Fusion together under Xvfb on aarch64, so a one-label pilot has to prove it

Verdict: middle. Confidence: medium.

I verified the platform selection in util.ts and the Xvfb guidance in the VS Code docs. The antithesis is right that choosing which build to download is not the same as a successful GUI launch. I lowered confidence from high to medium.

Citations:

- [r3a](../../scripts/test/run-integration.mjs): "const electron = await downloadAndUnzipVSCode(VSCODE_VERSION);"
- [r3b](../../scripts/test/integration-layout.mjs): "export const VSCODE_VERSION = "1.128.0";"
- [r3c](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/util.ts): "process.arch === 'arm64' ? 'linux-arm64' : process.arch === 'arm' ? 'linux-armhf' : 'linux-x64';"
- [r3d](https://code.visualstudio.com/api/working-with-extensions/continuous-integration): "In headless Linux CI machines xvfb is required to run VS Code, so if Linux is the current OS run the tests in an Xvfb enabled environment:"
- [r3e](https://code.visualstudio.com/api/working-with-extensions/continuous-integration): "apt install -y libasound2 libgbm1 libgtk-3-0 libnss3 xvfb"
- [r3f](../../scripts/test/run-integration.mjs): "const bin = path.join(root, "node_modules/.bin/vscode-test");"

Thesis (high): The integration suite has no platform gate, so it is the natural fit for Linux containers. run-integration.mjs:198 calls `downloadAndUnzipVSCode(VSCODE_VERSION)` with VS Code 1.128.0 (integration-layout.mjs:13), and .vscode-test.mjs passes the same version to test-cli. On an arm64 Linux machine, @vscode/test-electron's default platform is `linux-arm64`, so in an aarch64 container it fetches the arm64 Linux build without extra setup. On Linux, VS Code needs Xvfb. Microsoft documents Xvfb for headless CI and shows VS Code tests running in headless Docker containers. Its apt line lists the runtime libraries the image needs.

Thesis citations:

- [c3a](../../scripts/test/run-integration.mjs): "const electron = await downloadAndUnzipVSCode(VSCODE_VERSION);"
- [c3b](../../scripts/test/integration-layout.mjs): "export const VSCODE_VERSION = "1.128.0";"
- [c3f](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/util.ts): "process.arch === 'arm64' ? 'linux-arm64' : process.arch === 'arm' ? 'linux-armhf' : 'linux-x64';"
- [c3c](https://code.visualstudio.com/api/working-with-extensions/continuous-integration): "In headless Linux CI machines xvfb is required to run VS Code, so if Linux is the current OS run the tests in an Xvfb enabled environment:"
- [c3d](https://code.visualstudio.com/api/working-with-extensions/continuous-integration): "GitLab CI can be used to test and publish the extension in headless Docker containers."
- [c3e](https://code.visualstudio.com/api/working-with-extensions/continuous-integration): "apt install -y libasound2 libgbm1 libgtk-3-0 libnss3 xvfb"

Antithesis: [high] Linux-arm64 selection by `@vscode/test-electron` is real, but it does not make the repository’s current command Xvfb-enabled. `run-integration.mjs` launches the test CLI directly; the Docker invocation must wrap it in Xvfb or provide `DISPLAY`, and that needs validation rather than being presented as an established outcome.

Antithesis: [medium] The thesis assumes the downloaded VS Code version alone determines Linux viability. The suite also launches dbt and uses a generated wrapper, so the Linux Fusion executable and dynamic-library compatibility are part of the testable dependency chain.

Antithesis: [high] Default-platform selection is download selection, not evidence that a GUI Electron process was successfully run under an X server.

Counter-evidence:

- [a7](../../scripts/test/run-integration.mjs): "const bin = path.join(root, "node_modules/.bin/vscode-test"); const cliArgs = [ ...cliLabels.flatMap((label) => ["--label", label]),"
- [a8](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/util.ts): "default: systemDefaultPlatform = process.arch === 'arm64' ? 'linux-arm64' : process.arch === 'arm' ? 'linux-armhf' : 'linux-x64'; }"

### 4. Cursor publishes a Linux arm64 AppImage. Today's download API returned Cursor-3.23.23-aarch64.AppImage. The repo pins 3.21.16 with a darwin archive commit and a sha256 (pins.env:8-14). I have not confirmed a pinned Linux arm64 3.21.16 artifact, its checksum, or whether its product.json matches the darwin one. Until those are recorded, a Cursor container is not a pinned host. I did not check whether a .deb exists or whether the AppImage needs FUSE

Verdict: middle. Confidence: medium.

I re-fetched the API and it returns the latest AppImage. The antithesis is right that 'latest' does not stand in for the pinned version. That does not refute the claim that Cursor ships an AppImage at all.

Citations:

- [r4a](https://www.cursor.com/api/download?platform=linux-arm64&releaseTrack=latest): "<https://downloads.cursor.com/production/2dac2428994fe34f12658d9ecad1541b98db2c04/linux/arm64/Cursor-3.23.23-aarch64.AppImage>"
- [r4b](../../scripts/smoke/pins.env): "FPU_CURSOR_VERSION=3.21.16"

Thesis (medium): Cursor publishes a Linux arm64 build as an AppImage. Its download API, asked for platform=linux-arm64, returned an aarch64 AppImage for version 3.23.23. The repo pins Cursor 3.21.16 for darwin, so a Linux pin needs its own URL, commit and sha256 for the 3.21.16 AppImage, if Cursor still serves that version. My request for a linux-arm64 .deb returned HTTP 500, so I could not confirm that a .deb exists. AppImages normally need FUSE or `--appimage-extract`, and extracting is the usual approach in Docker. I did not verify that.

Thesis citations:

- [c4a](https://www.cursor.com/api/download?platform=linux-arm64&releaseTrack=latest): "<https://downloads.cursor.com/production/2dac2428994fe34f12658d9ecad1541b98db2c04/linux/arm64/Cursor-3.23.23-aarch64.AppImage>"
- [c4b](../../scripts/smoke/pins.env): "FPU_CURSOR_VERSION=3.21.16"

Antithesis: [high] This is not sufficient evidence for a reproducible Cursor container. A latest-channel Linux ARM URL for 3.23.23 does not establish that the repository’s pinned 3.21.16 exists on Linux, has the same Cursor/VS Code compatibility characteristics, or is obtainable after the URL changes.

Antithesis: [high] The proposed Docker design therefore cannot honestly claim Cursor is pinned until it records a version-specific Linux URL, checksum, archive format, extraction procedure, and `product.json` verification equivalent to the existing Darwin path.

Antithesis: [high] The evidence for a current latest AppImage is being substituted for evidence about the required pinned release.

Counter-evidence:

- [a9](../../scripts/smoke/pins.env): "FPU_CURSOR_VERSION=3.21.16 FPU_CURSOR_ARCHIVE_COMMIT=8ae78e8eee1e63479c7e0504b664bc0a80c6800f FPU_CURSOR_PRODUCT_COMMIT=8ae78e8eee1e63479c7e0504b664bc0a80c68000"
- [a10](../../scripts/smoke/fetch-cursor.sh): "verify_sha256 "$dmg" "$FPU_CURSOR_SHA256" mount=$(attach_dmg "$dmg")"
- [a11](../../scripts/smoke/fetch-cursor.sh): "actual = (product.get("version"), product.get("commit"), product.get("vscodeVersion")) expected = (expected_version, expected_commit, expected_vscode_version) if actual != expected:"

### 5. The repo already settles the Fusion question. mise.lock pins 2.0.6 for linux-arm64 as the glibc tarball fs-v2.0.6-aarch64-unknown-linux-gnu, and it also has a musl variant. A Debian image should use the glibc artifact. The runner finds dbt through FPU_INTEGRATION_DBT_PATH (absolute) or `which dbt`, and AGENTS.md requires tests to find it through configuration or PATH. So a Fusion binary from `mise install --locked` on PATH, or set through FPU_INTEGRATION_DBT_PATH, is enough. One caveat is new: the linux-arm64 Fusion entry has no checksum, while the macos-arm64 entry does (mise.lock:39-53)

Verdict: antithesis. Confidence: high.

I read mise.lock myself, and the linux-arm64 gnu URL for 2.0.6 is there. The thesis's 'not verified' was unnecessary. I also noticed the checksum gap, which neither side mentioned.

Citations:

- [r5a](../../mise.lock): "url = "<https://public.cdn.getdbt.com/fs/cli/fs-v2.0.6-aarch64-unknown-linux-gnu.tar.gz>""
- [r5b](../../mise.lock): "checksum = "sha256:1ff8e942149c9c42e0a26419f294c3293e500b84264ccb95a1ff9b6585c88ddb""
- [r5c](../../scripts/test/run-integration.mjs): "const fusionPath = process.env.FPU_INTEGRATION_DBT_PATH;"
- [r5d](../../AGENTS.md): "The tests must locate that binary through configuration or `PATH`, never by shelling out to mise, so the same suite passes on a machine without it."

Thesis (medium): Fusion is pinned through mise and aqua (mise.toml:14), with a lockfile (mise.toml:17). The integration runner finds dbt through FPU_INTEGRATION_DBT_PATH, which must be an absolute path, or otherwise through `which dbt` (run-integration.mjs:46-50,92-94). While preparing the native labels it runs `dbt run-operation setup_raw`. So a container only needs a working linux-arm64 Fusion 2.0.6 on PATH. dbt Labs lists Linux on ARM as supported and says Fusion can be installed in a docker container. I did not verify that a linux-arm64 artifact exists for exactly 2.0.6, or that mise.lock has a linux-arm64 entry. Running `mise install --locked` in the image build settles both.

Thesis citations:

- [c5a](../../mise.toml): ""aqua:getdbt.com/dbt-fusion" = "2.0.6""
- [c5b](../../scripts/test/run-integration.mjs): "const fusionPath = process.env.FPU_INTEGRATION_DBT_PATH;"
- [c5c](../../scripts/test/run-integration.mjs): "spawnSync("which", ["dbt"], { encoding: "utf-8" }).stdout.trim();"
- [c5d](../../scripts/test/run-integration.mjs): "const setupArgs = ["run-operation", "setup_raw", "--profiles-dir", dir];"
- [c5e](https://raw.githubusercontent.com/dbt-labs/dbt-fusion/main/README.md): "You can install dbt-fusion onto your local machine, a docker container, or a machine in the cloud."
- [c5f](https://raw.githubusercontent.com/dbt-labs/dbt-fusion/main/README.md): "| Linux | 🟢 | 🟢 |"

Antithesis: [high] The claimed uncertainty about a Fusion 2.0.6 Linux-arm64 artifact is simply wrong. This repository’s committed lock file names both glibc and musl ARM64 2.0.6 artifacts. “Check it during the image build” wastes time and weakens a conclusion that the repository already proves.

Antithesis: [medium] The outline should choose the glibc artifact for Debian/Bookworm explicitly, rather than treating all Linux-arm64 artifacts as interchangeable.

Antithesis: [high] The thesis cites `mise.toml` but failed to inspect the platform-resolved `mise.lock`, which is the decisive source for this question.

Counter-evidence:

- [a12](../../mise.lock): "[tools."aqua:getdbt.com/dbt-fusion"."platforms.linux-arm64"] url = "<https://public.cdn.getdbt.com/fs/cli/fs-v2.0.6-aarch64-unknown-linux-gnu.tar.gz>""
- [a13](../../mise.lock): "[tools."aqua:getdbt.com/dbt-fusion"."platforms.linux-arm64-musl"] url = "<https://public.cdn.getdbt.com/fs/cli/fs-v2.0.6-aarch64-unknown-linux-musl.tar.gz>""

### 6. Profiles are isolated per run. Integration creates a mkdtemp root under realpath(tmpdir), and each label gets its own `u` (user-data) and `x` (extensions) dirs, passed as --user-data-dir and --extensions-dir. Smoke creates mkdtemp user-data, extensions and workspace dirs on every run. Repository-relative outputs are not isolated. run-smoke.mjs always copies out/package.json (lines 65-68), even with FPU_SKIP_INTEGRATION_COMPILE=1. The VSIX launch writes out/test/integration/untrusted/package.json. The pinned-host cache is shared under ~/Library/Caches by default. So 'two concurrent runs share nothing' holds only for profiles, not for the checkout

Verdict: middle. Confidence: high.

I confirmed both the per-run temp dirs and the unconditional out/package.json write. The antithesis rightly narrows the thesis's broad conclusion.

Citations:

- [r6a](../../scripts/test/run-integration.mjs): "path.join(realpathSync(tmpdir()), "fpu-integration-"),"
- [r6b](../../scripts/test/integration-layout.mjs): "userData: path.join(base, "u"),"
- [r6c](../../.vscode-test.mjs): "`--user-data-dir=${layout.userData}`,"
- [r6d](../../scripts/smoke/run-smoke.mjs): "const userDataDir = mkdtempSync(path.join(tmpdir(), `fpu-smoke-${host}-`));"
- [r6e](../../scripts/smoke/run-smoke.mjs): "path.join(root, "out/package.json"),"

Thesis (high): Profile state is already isolated per run. Integration creates a fresh mkdtemp root (run-integration.mjs:52-54). Under that root each label gets its own `u` (user-data) and `x` (extensions) dirs (integration-layout.mjs:31-52), which .vscode-test.mjs passes as --user-data-dir and --extensions-dir. Smoke creates its own mkdtemp dirs for user data, extensions and the workspace on every run (run-smoke.mjs:70-76). The spy log lives under the run's root, so only labels in the same run share it. Two concurrent runs therefore share no profiles, extension installs or fixtures.

Thesis citations:

- [c6a](../../scripts/test/run-integration.mjs): "path.join(realpathSync(tmpdir()), "fpu-integration-"),"
- [c6b](../../.vscode-test.mjs): "`--user-data-dir=${layout.userData}`,"
- [c6c](../../scripts/smoke/run-smoke.mjs): "const userDataDir = mkdtempSync(path.join(tmpdir(), `fpu-smoke-${host}-`));"
- [c6d](../../.vscode-test.mjs): "FPU_DBT_SPY_LOG: path.join(root, "spy", SPY_LOG_FILE),"

Antithesis: [high] Per-label profiles are isolated, but the conclusion “two concurrent runs therefore share no profiles, extension installs or fixtures” overstates what was inspected. It says nothing about the host download cache, test-electron cache, compiled `out/` tree, packaged VSIX, or screenshot destination.

Antithesis: [high] The smoke runner itself writes `out/package.json` even when compilation is skipped. That is shared-checkout mutation and directly contradicts the broad isolation claim.

Antithesis: [high] Temporary user-data and extensions directories do not isolate repository-relative build outputs.

Counter-evidence:

- [a14](../../scripts/smoke/run-smoke.mjs): "copyFileSync( path.join(root, "src/test/integration/out-package.json"), path.join(root, "out/package.json"), );"
- [a15](../../scripts/smoke/common.sh): "cache_root=${FPU_HOST_CACHE:-${XDG_CACHE_HOME:-$HOME/Library/Caches}/fusion-power-user/hosts}"

### 7. The shared working copy is what makes concurrent runs unsafe. `just test-integration` runs `just clean`, `just package`, a dev build, compile:integration and a copy into out/package.json (justfile:208-214). `just package` deletes every *.vsix and out/latest-vsix, then rewrites out/latest-vsix (justfile:284-306). Each concurrent run therefore needs its own writable worktree, including node_modules and out/. The copy must be made before any mutating command. I found no reference to /tmp/fpu-heavy.lock in the justfile, AGENTS.md, run-integration.mjs, .vscode-test.mjs, measure-runtime.mjs, ci.yml or the smoke scripts I read. That search did not cover the whole repo, and the lock may live in user-level hooks or agent tooling

Verdict: middle. Confidence: medium.

I confirmed the destructive recipe lines. The antithesis is right that a hand-picked set of files is not a repo-wide search, so 'the lock is an outside convention' is downgraded to 'not found in the files read'.

Citations:

- [r7a](../../justfile): "cp src/test/integration/out-package.json out/package.json"
- [r7b](../../justfile): "rm -f ./*.vsix out/latest-vsix"
- [r7c](../../justfile): "realpath "$vsix" > out/latest-vsix"
- [r7d](../../scripts/test/run-integration.mjs): "path.join(root, "out/test/integration/untrusted/package.json"),"

Thesis (high): The checkout itself is shared, and that is what blocks concurrent runs in one working copy. `just test-integration` starts with `just clean`, which deletes out, coverage and dist. It then repackages, rebuilds and copies out/package.json. The untrusted runner writes out/test/integration/untrusted/package.json. Smoke recompiles into out/ unless FPU_SKIP_INTEGRATION_COMPILE=1, and it also copies out/package.json. `just package` deletes every other VSIX and rewrites out/latest-vsix, which the VSIX labels read. VS Code downloads go to test-electron's default cache, `.vscode-test` under the working directory, which is the checkout. Two runs in the same checkout would delete or overwrite each other's out/ and VSIX, and a heavy lock serialises exactly this. None of the repo files I read mentions /tmp/fpu-heavy.lock: not the justfile, lefthook.yml, run-integration.mjs or the smoke scripts. The lock is a convention kept outside the repo.

Thesis citations:

- [c7a](../../justfile): "cp src/test/integration/out-package.json out/package.json"
- [c7b](../../package.json): "for (const d of ['out','coverage','dist'])"
- [c7c](../../scripts/test/run-integration.mjs): "path.join(root, "out/test/integration/untrusted/package.json"),"
- [c7d](../../scripts/smoke/run-smoke.mjs): "if (process.env.FPU_SKIP_INTEGRATION_COMPILE !== "1") {"
- [c7e](../../AGENTS.md): "`just package` deletes every other `*.vsix` in the repository root and records the new path in `out/latest-vsix`; a smoke recipe without `--vsix` packages first, and CI passes its checksum-verified artifact with `--vsix`."
- [c7f](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/download.ts): "export const defaultCachePath = path.resolve(extensionRoot, '.vscode-test');"

Antithesis: [high] “The checkout itself is shared, and that is what blocks concurrent runs” is directionally right but incomplete: the thesis identifies several destructive writes, yet recommends a read-only repository mount followed by an unspecified copy. The copy must happen before every mutable command and must include writable `node_modules` handling if lifecycle/build tooling writes there.

Antithesis: [medium] “None of the repo files mentions `/tmp/fpu-heavy.lock`” does not establish that the lock is merely an outside convention. Absence from a hand-picked file list is not a repository-wide search, and the caller reports that the actual gate is serialized by it.

Antithesis: [high] The cited recipe already proves destructive worktree operations; it does not prove that they are the only synchronization mechanism in use.

Counter-evidence:

- [a16](../../justfile): "test-integration *args: just clean just package npm run build:dev"
- [a17](../../justfile): "rm -rf dist # Only the VSIX built here may exist, so nothing downstream can install an older one. rm -f ./*.vsix out/latest-vsix"

### 8. The suite has 5 CLI labels and 2 VSIX labels. `--label` filters which labels launch (run-integration.mjs:39-44). prepareLabel still runs for all 7 labels on every invocation (lines 113-115), and the VSIX labels run one after another (lines 129-133). The CLI labels all go to one vscode-test invocation, which runs them in sequence. Sharding 7 ways without a fix repeats all fixture and dbt setup 7 times. Preparing only the selected labels should come before fan-out. It is a small diff but changes behaviour, so it needs a test

Verdict: thesis. Confidence: high.

Both sides agree on the code, and I confirmed it. The antithesis's objection to the word 'cheap' is fair but does not change the finding.

Citations:

- [r8a](../../scripts/test/run-integration.mjs): "for (const label of [...LABELS, ...VSIX_LABELS]) {"
- [r8b](../../scripts/test/run-integration.mjs): "failed ||= (await runVsixLaunch(label)) !== 0;"
- [r8c](../../scripts/test/integration-layout.mjs): "export const VSIX_LABELS = [UNTRUSTED_LABEL, TRUSTED_VSIX_LABEL];"

Thesis (high): Labels can be split across processes, but every process prepares every label. There are five CLI labels (trusted, symlinked, native-strict, native-baseline, native-project) and two VSIX labels (untrusted, trusted-vsix). `--label` picks which ones run (run-integration.mjs:39-44). But prepareLabel still runs for all labels in every invocation (run-integration.mjs:113-115), including three dbt setup_raw calls for the native fixtures. The VSIX labels run one after another in a loop (run-integration.mjs:129-133). A cheap fix before fanning out is to prepare only the selected labels.

Thesis citations:

- [c8a](../../scripts/test/run-integration.mjs): "for (const label of [...LABELS, ...VSIX_LABELS]) {"
- [c8b](../../scripts/test/run-integration.mjs): "failed ||= (await runVsixLaunch(label)) !== 0;"
- [c8c](../../scripts/test/integration-layout.mjs): "export const VSIX_LABELS = [UNTRUSTED_LABEL, TRUSTED_VSIX_LABEL];"

Antithesis: [high] The proposed seven-container fan-out is materially less efficient than represented: every shard prepares all seven labels before filtering which labels execute. Thus seven shards multiply setup work by seven, including fixture setup and any dbt work in `prepareLabel`.

Antithesis: [medium] Calling the change “cheap” is unsupported. It changes preparation semantics, including the direct VSIX launches that rely on generated output paths, and needs tests.

Antithesis: [high] The `--label` filter applies to the later launch selection; it is not used by the preceding preparation loop.

Counter-evidence:

- [a18](../../scripts/test/run-integration.mjs): "for (const label of [...LABELS, ...VSIX_LABELS]) { prepareLabel(label); }"
- [a19](../../scripts/test/run-integration.mjs): "const cliLabels = labels.filter((label) => !VSIX_LABELS.includes(label)); const runCli = !labels.length || cliLabels.length > 0; const vsixLabels = VSIX_LABELS.filter("

### 9. A macOS guest is the faithful way to isolate smoke runs. It runs the pinned darwin .app and the hdiutil/ditto fetch unchanged. It is not a speed win. Tart says it uses the same technology as Anka 3.0 and expects no real performance difference, but that is the vendor's claim, not a benchmark. The Tart quick-start image is a 25 GB download. That figure is not the on-disk size of a configured clone, and I found no measured boot time. A blog, not Apple, reports the 2-VM limit; I could not quote Apple's licence text. Running headless needs an unlocked login keychain on macOS 15+ hosts, and an auto-login GUI session in the guest, because VS Code and Cursor need a window server. Lima's macOS-guest support is experimental. At most two guests means isolation, not more parallelism than running both hosts directly on the Mac

Verdict: middle. Confidence: medium.

I re-fetched every quoted source. The antithesis is right that the size, speed and boot claims are unmeasured, but the facts the thesis cited stand.

Citations:

- [r9a](https://tart.run/faq/): "Under the hood Tart is using the same technology as Anka 3.0 so there should be no real difference in performance"
- [r9b](https://tart.run/faq/): "this will maintain a running user session (GUI) even after the machine reboots"
- [r9c](https://tart.run/quick-start/): "Try running a Tart VM on your Apple Silicon device running macOS 13.0 (Ventura) or later (will download a 25 GB image):"
- [r9d](https://www.jochendelabie.com/2023/09/20/macos-virtualization-framework/): "The macOS Virtualization.Framework allows you to run up to 2 macOS VMs (Virtual Machines) on Apple hardware."
- [r9e](https://lima-vm.io/docs/usage/guests/macos/): "Running macOS guests is experimentally supported since Lima v2.1."

Thesis (medium): macOS VMs. Tart uses Apple's Virtualization.framework, the same technology as Anka 3.0, so their performance should match. Tart's base macOS image is about 25 GB to download. A secondary source reports that Apple's EULA limits a Mac to 2 macOS VMs and that Virtualization.framework VMs boot very fast. I could not extract Apple's own licence text from its compressed PDF, and I have no measured boot time. Lima's macOS-guest support is only experimental (Lima ≥ 2.1). On macOS 15+ hosts, Virtualization.framework needs an unlocked login keychain to start VMs. Configuring automatic login keeps a GUI user session alive, and VS Code and Cursor need that session's window server even when no one is viewing the VM. A macOS guest runs the pinned darwin `.app` builds and the hdiutil/ditto fetch unchanged, so it is the faithful way to isolate smoke runs. With at most two guests, it buys isolation rather than much extra parallelism over running both hosts directly on the Mac.

Thesis citations:

- [c9a](https://tart.run/faq/): "Under the hood Tart is using the same technology as Anka 3.0 so there should be no real difference in performance"
- [c9b](https://tart.run/faq/): "there's an undocumented requirement from Virtualization.Framework (which Tart uses)"
- [c9c](https://tart.run/faq/): "this will maintain a running user session (GUI) even after the machine reboots"
- [c9d](https://tart.run/quick-start/): "Try running a Tart VM on your Apple Silicon device running macOS 13.0 (Ventura) or later (will download a 25 GB image):"
- [c9e](https://www.jochendelabie.com/2023/09/20/macos-virtualization-framework/): "The limit of 2 VMs per machine is due to Apple&#8217;s EULA, explicitly setting a maximum of 2 copies of macOS per Apple machine."
- [c9f](https://www.jochendelabie.com/2023/09/20/macos-virtualization-framework/): "The advantages of using the framework is very fast boot times for macOS VMs, speedy graphics and ease of use."
- [c9g](https://lima-vm.io/docs/usage/guests/macos/): "Running macOS guests is experimentally supported since Lima v2.1."

Antithesis: [high] “Tart uses Apple’s Virtualization.framework, the same technology as Anka 3.0, so their performance should match” is not a performance result. Shared virtualization substrate does not equal identical image formats, storage behavior, VM configuration, graphics setup, provisioning, or boot time.

Antithesis: [high] The 25 GB number is explicitly a download size for one Tart quick-start image, not a general guest image size, disk footprint after configuration, clone size, or boot-time measurement.

Antithesis: [medium] The thesis correctly flags the GUI/keychain prerequisite but still does not provide an unattended launch design for a GUI session, Screen Sharing/bootstrap, or how smoke screenshots/rendering are observed.

Antithesis: [high] The Tart material supports a 25 GB download and a macOS-15 headless-start caveat; it does not support measured speed or fidelity claims.

Counter-evidence:

- [a20](https://tart.run/quick-start/): "Try running a Tart VM on your Apple Silicon device running macOS 13.0 (Ventura) or later (will download a 25 GB image):"
- [a21](https://tart.run/faq/): "Starting from macOS 15 (Sequoia), there's an undocumented requirement from Virtualization.Framework (which Tart uses) to have an unlocked login.keychain available at the times when running a VM."
- [a22](https://tart.run/faq/): "configure automatic log in to a Mac user account this will maintain a running user session (GUI) even after the machine reboots"

### 10. Confirmed: Docker on Colima cannot run macOS containers. Containers depend on Linux kernel namespaces and cgroups, so every container on a Mac is a Linux container inside a Linux VM. Isolating macOS needs a full VM. Tart, or the commercial Anka, are the practical options. Lima with vz is mature for Linux guests, but its macOS guests are experimental, so it should not be the primary route

Verdict: middle. Confidence: medium.

The conclusion holds, but the only source I read is a blog. The antithesis's Lima distinction is correct, and I added it.

Citations:

- [r10a](https://drigo.ro/writing/containers-on-macos): "There is no such thing as a macOS container."
- [r10b](https://drigo.ro/writing/containers-on-macos): "Containers are a Linux kernel feature — namespaces and cgroups."

Thesis (medium): Docker on Colima cannot run macOS containers. Every container on a Mac is a Linux container inside a Linux VM, because containers depend on Linux kernel features that macOS lacks. Isolating macOS therefore needs a full VM: Tart, Anka, or Lima with vz.

Thesis citations:

- [c10a](https://drigo.ro/writing/containers-on-macos): "There is no such thing as a macOS container. Every container you run on a Mac is a Linux container, running inside a Linux VM that something started on your behalf."
- [c10b](https://drigo.ro/writing/containers-on-macos): "Pulling an amd64 image means emulation, and emulation is slow."

Antithesis: [medium] The conclusion is correct for the stated Docker/Colima setup, but its support is a blog rather than vendor documentation. The reliable operational statement is that Docker Desktop runs containers in a Linux VM; that establishes why a Linux container cannot exercise the pinned Darwin `.app` artifacts.

Antithesis: [high] The list “Tart, Anka, or Lima with vz” blurs two distinct propositions: Lima `vz` is mature for Linux guests, whereas Lima’s macOS guest support is explicitly experimental.

Antithesis: [high] Saying that Lima uses Virtualization.framework does not make its macOS guest workflow production-ready.

Counter-evidence:

- [a23](https://lima-vm.io/docs/usage/guests/macos/): "Running macOS guests is experimentally supported since Lima v2.1."
- [a24](https://lima-vm.io/docs/config/vmtype/vz/): "“vz” option makes use of native virtualization support provided by macOS Virtualization.Framework. “vz” has been the default driver for macOS hosts since Lima v1.0."

### 11. CI never runs `just test-integration`. check-and-package.yml runs `just check`, `just package` and a checksum on macos-latest. Smoke CI does compile the integration output (measure-runtime.mjs:26), but compiling is not running the suite. So moving integration to Linux costs no CI parity. Integration does lose fidelity to what macOS users get, which the 30-45 minute local gate covers today. Smoke CI is heavier than one run per host: each host runs benchmark-runtime with 10 sequential smoke iterations, then a separate multi-root smoke with FPU_SMOKE_REQUIRE_FUSION=1. The macOS socket-path limit is documented in the repo. Other losses are inferred, not demonstrated: realpath /private/var, APFS case-insensitivity, fonts and rendering in smoke-visual PNGs, and `sample` diagnostics

Verdict: middle. Confidence: medium.

I read both workflows and measure-runtime.mjs. The antithesis's 'compile' objection does not show that integration runs in CI. Its point about the smoke workload and the uncited parity losses is valid.

Citations:

- [r11a](../../.github/workflows/check-and-package.yml): "run: shasum -a 256 ./*.vsix | tee vsix.sha256"
- [r11b](../../.github/workflows/ci.yml): "just benchmark-runtime-vscode fusion-power-user-*.vsix"
- [r11c](../../scripts/benchmark/measure-runtime.mjs): "for (let index = 0; index < 10; index += 1) {"
- [r11d](../../.github/workflows/ci.yml): "just smoke-cursor --vsix fusion-power-user-*.vsix --fixture src/test/fixtures/multi-root"
- [r11e](../../scripts/test/integration-layout.mjs): "// Short names: VS Code's IPC socket lives in the user-data dir, and macOS caps socket paths at 103 bytes."

Thesis (high): Parity: moving integration to Linux costs no CI parity, because CI never runs it. check-and-package.yml runs `just check` and `just package` on macos-latest, then checksums and uploads the VSIX. Smoke runs in ci.yml's smoke-vscode and smoke-cursor jobs on macos-latest, using benchmark-runtime (10 smoke iterations per host) plus a multi-root smoke. A Linux run would lose these macOS-specific behaviours: the 103-byte socket-path limit the layout is designed around; the realpath of tmpdir (/private/var); APFS case-insensitivity; the darwin Cursor build's commit; fonts and rendering in the smoke-visual PNGs; and `sample` diagnostics.

Thesis citations:

- [c11a](../../.github/workflows/check-and-package.yml): "run: shasum -a 256 ./*.vsix | tee vsix.sha256"
- [c11b](../../.github/workflows/ci.yml): "just benchmark-runtime-vscode fusion-power-user-*.vsix"
- [c11c](../../scripts/benchmark/measure-runtime.mjs): "for (let index = 0; index < 10; index += 1) {"
- [c11d](../../scripts/test/integration-layout.mjs): "// Short names: VS Code's IPC socket lives in the user-data dir, and macOS caps socket paths at 103 bytes."

Antithesis: [high] The parity discussion understates that CI smoke has two modes: benchmark runtime runs ten iterations per host and multi-root smoke runs separately. A local “one smoke per host” concurrent design is not equivalent to the CI smoke workload.

Antithesis: [high] Several asserted macOS parity losses—APFS case behavior, font/rendering differences, the private tmpdir path, and the exact Cursor build behavior—are plausible but uncited. They must be labelled speculative rather than presented as established repo facts.

Antithesis: [high] The workflow proves macOS runners and the commands they invoke; it does not prove every listed filesystem, font, or rendering consequence.

Counter-evidence:

- [a25](../../scripts/benchmark/measure-runtime.mjs): "for (let index = 0; index < 10; index += 1) { const port = await findAvailablePort(nextPort); nextPort = port + 1;"
- [a26](../../.github/workflows/ci.yml): "- name: Multi-root LSP smoke Cursor pinned stable env: FPU_SKIP_INTEGRATION_COMPILE: "1" FPU_SMOKE_REQUIRE_FUSION: "1""

### 12. Dockerfile outline, untested. Base: debian:bookworm-slim on arm64. Packages: xvfb, xauth, libasound2, libgbm1, libgtk-3-0, libnss3, python3, perl (for shasum), unzip, git, curl, fonts. Install mise and run `mise install --locked`. That gives Node 24.21.0 and Fusion 2.0.6 glibc from mise.lock; add a linux-arm64 checksum for Fusion first. Run `npm ci` in a layer keyed on package-lock. Caching VS Code needs care: test-electron's default cache is `.vscode-test` under process.cwd(), and the runner passes no cachePath. Bake VS Code 1.128.0 into `/work/.vscode-test` and copy each shard's tree into that same /work, excluding .vscode-test. Or mount a shared volume at <worktree>/.vscode-test. A cache in any other directory is never found. Set FPU_INTEGRATION_DBT_PATH to the image's Fusion binary. Mount the repo read-only and rsync it into /work before any just/npm command. Mount the VSIX read-only and write its path into out/latest-vsix. Leave Cursor out of the image until a pinned Linux artifact exists

Verdict: middle. Confidence: low.

I confirmed the antithesis's cache-path finding in download.ts. Its fix is right in kind. A fixed in-image work path is a simpler fix than changing the runner, which the antithesis did not mention.

Citations:

- [r12a](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/download.ts): "const extensionRoot = process.cwd();"
- [r12b](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/download.ts): "export const defaultCachePath = path.resolve(extensionRoot, '.vscode-test');"
- [r12c](../../mise.lock): "url = "<https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.gz>""
- [r12d](../../mise.toml): ""aqua:getdbt.com/dbt-fusion" = "2.0.6""

Thesis (low): Recommended Dockerfile outline (a design I have not tested). Base: debian:bookworm-slim, arm64. Install Xvfb/xvfb-run, libasound2, libgbm1, libgtk-3-0, libnss3, python3, perl (for shasum), git, curl and fonts. Install mise and run `mise install --locked` to get Node 24 and dbt Fusion 2.0.6 from mise.toml; it is contributor tooling and pins Fusion deliberately. Bake VS Code 1.128.0 linux-arm64 into the image by running test-electron's download at build time, so `.vscode-test` is already populated. Add an extracted Cursor AppImage only once Linux smoke exists. Run `npm ci` in a layer keyed on the lockfile. Mounts: bind the repo read-only and copy it into the container (rsync or `git worktree`) so each container has a private out/. Mount the VSIX from CI or `just package` read-only, and point out/latest-vsix at it. Set FPU_INTEGRATION_DBT_PATH to the image's Fusion binary.

Thesis citations:

- [c12a](../../mise.toml): "Fusion is pinned to the minimum version the product claims, so a"
- [c12b](../../mise.toml): ""aqua:getdbt.com/dbt-fusion" = "2.0.6""
- [c12c](https://code.visualstudio.com/api/working-with-extensions/continuous-integration): "apt install -y libasound2 libgbm1 libgtk-3-0 libnss3 xvfb"

Antithesis: [high] Baking `.vscode-test` into the image will not automatically cache the integration download at runtime. `@vscode/test-electron` derives its default cache from `process.cwd()`, and this runner calls the download API without a `cachePath`; copying the repository to a per-container working directory therefore misses an image-layer cache.

Antithesis: [high] The Dockerfile outline is incomplete as a reproducible build: it has no verified Linux Cursor artifact, no cache-path change or seeded runtime cache, no explicit Debian-compatible Fusion selection, and no command that proves the complete image can launch the suite.

Antithesis: [high] “Pre-install VS Code in the image” is not the same as arranging for this code path to discover that installation.

Counter-evidence:

- [a27](../../scripts/test/run-integration.mjs): "const electron = await downloadAndUnzipVSCode(VSCODE_VERSION);"
- [a28](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/download.ts): "const extensionRoot = process.cwd();"
- [a29](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/download.ts): "export const defaultCachePath = path.resolve(extensionRoot, '.vscode-test');"

### 13. The thesis's fan-out plan has two defects. First, measure-runtime.mjs runs compile:integration unconditionally in the checkout, so FPU_SKIP_INTEGRATION_COMPILE does not protect it. Running the two benchmark-runtime hosts at once in one checkout races on out/. Each host therefore needs its own worktree. Second, Colima is 6 CPU / 16 GiB today, so expect about 2-3 Electron+Fusion shards until Colima is resized and measured. A workable plan: package once on the host. Fix prepareLabel. Run integration shards in Linux containers, about 3-4 groups, not 7. At the same time, run smoke-vscode and smoke-cursor in two private macOS worktrees with --vsix. The best-case wall time is `just check` plus max(slowest shard, slower host smoke). Any minute figure is unmeasured; the thesis's 12-18 minutes is a guess

Verdict: antithesis. Confidence: speculative.

I confirmed the unconditional compile at measure-runtime.mjs:26 and the separate --vsix path. The parallel structure is sound, but the race and the capacity mismatch break the thesis's concrete plan.

Citations:

- [r13a](../../scripts/benchmark/measure-runtime.mjs): "const compile = spawnSync("npm", ["run", "compile:integration"], {"
- [r13b](../../scripts/smoke/run-smoke.mjs): "if (process.env.FPU_SKIP_INTEGRATION_COMPILE !== "1") {"
- [r13c](../../justfile): "just smoke-vscode --vsix "$vsix" "$@""
- [r13d](../../scripts/smoke/run-host-smoke.sh): "(cd "$repo_root" && just package)"

Thesis (speculative): Fan-out and expected wall time (an estimate, not a measurement). Package and compile once. Then run 7 integration containers, each running `xvfb-run -a npm run test:integration -- --label <L>`. At the same time, run smoke-vscode and smoke-cursor concurrently on the Mac with FPU_SKIP_INTEGRATION_COMPILE=1 and the prebuilt VSIX passed by --vsix, which skips the package and compile steps that would otherwise race. Colima at 6 CPU / 16 GiB fits about 3–4 Electron+Fusion containers; at about 12 CPU / 40 GiB it should fit all 7 shards. Wall time should then be roughly `just check` + the slowest label + the slower host smoke, instead of their sum: perhaps 12–18 minutes against today's 30–45. Measure this before relying on it.

Thesis citations:

- [c13a](../../justfile): "just smoke-vscode --vsix "$vsix" "$@""
- [c13b](../../scripts/smoke/run-host-smoke.sh): "(cd "$repo_root" && just package)"

Antithesis: [high] The suggested concurrent Mac smoke invocations still race in a shared checkout. `benchmark-runtime-*` unconditionally compiles integration output, and both the benchmark and smoke code use `cwd: root`; setting `FPU_SKIP_INTEGRATION_COMPILE=1` only helps the ordinary smoke path, not the benchmark script.

Antithesis: [high] The capacity estimate is unsupported and mismatched to the stated machine configuration. The available Docker runtime is currently Colima at 6 CPU/16 GiB, not the Mac’s 18 cores/64 GB. Seven Electron-plus-Fusion shards cannot be assumed to receive the host’s unused resources unless Colima is reconfigured and measured.

Antithesis: [high] The 12–18 minute figure is speculative twice over: it assumes perfect sharding despite all-label preparation, and assumes concurrent macOS smoke without resolving the compilation race.

Antithesis: [high] The ordinary smoke runner honors the skip variable only around its own compile call; the runtime benchmark has an unconditional compile call.

Counter-evidence:

- [a30](../../scripts/smoke/run-smoke.mjs): "if (process.env.FPU_SKIP_INTEGRATION_COMPILE !== "1") { const compile = spawnSync("npm", ["run", "compile:integration"], {"
- [a31](../../scripts/benchmark/measure-runtime.mjs): "const compile = spawnSync("npm", ["run", "compile:integration"], { cwd: root, stdio: "inherit", });"

### 14. In mise.lock, the Fusion 2.0.6 linux-arm64 entry has only a URL. The macos-arm64 entry has a sha256, and so do the node and dprint linux entries. A Linux image built with `mise install --locked` therefore gets the right version of Fusion, but the download is not integrity-checked the way it is on macOS. Regenerate the lock with linux-arm64 checksums, for example by running `mise lock` for that platform, before treating the container as fully pinned

Verdict: new. Confidence: high.

I read mise.lock lines 39-57 directly. Only the macOS Fusion entries have checksum lines.

Citations:

- [r14a](../../mise.lock): "url = "<https://public.cdn.getdbt.com/fs/cli/fs-v2.0.6-aarch64-unknown-linux-gnu.tar.gz>""
- [r14b](../../mise.lock): "checksum = "sha256:1ff8e942149c9c42e0a26419f294c3293e500b84264ccb95a1ff9b6585c88ddb""

## Docker pilot

All seven integration labels run in Linux arm64 containers on Colima (aarch64, 6 CPU, 16 GiB) under `xvfb-run -a`, with Electron, the dbt spy wrapper and Fusion 2.0.6 working on aarch64. `just test-integration-docker` runs every label; `just test-integration-docker <label>` runs one.

Files: `docker/integration/Dockerfile`, `docker/integration/fetch-vscode.mjs`, `.dockerignore`, `scripts/test/docker-integration.sh`, `scripts/test/integration-result.mjs` (log parsing and the parity verdict), `scripts/test/integration-expected.json`, `scripts/test/integration-shards.mjs`, `scripts/test/integration-summary.mjs`, and `DOCKER_SHARDS` in `scripts/test/integration-layout.mjs`.

Design: the host runs `just build-integration` (clean, package, build, compile) once while the image builds in parallel. Four shards then start as separate `docker run`s: `trusted` alone, and three groups of the other labels. Each container mounts the repository read-only at `/src`, copies it into its own `/work` (keeping the host-built `out/`, `dist/` and VSIX, and rewriting `out/latest-vsix` to the container path), and runs its labels one after another. The image supplies `node_modules` from `npm ci --strict-allow-scripts`, Node and Fusion from `mise.lock`, and VS Code baked into `/work/.vscode-test`. No shard runs `npm ci` or `just package`, and no two shards share a writable directory. Output is printed as one summary table of label, passing and pending against expected, seconds, and ok/FAIL; the exit code is non-zero if any label fails.

Parity gate: a label passes only with exit code 0, no failing test, a passing count equal to the expected one and a pending count no greater than expected. A silent skip (Fusion not found, 0 passing) therefore fails. The counts are the host baseline on pinned Fusion 2.0.6: trusted 55/8, symlinked 3/0, native-strict 9/0, native-baseline 4/5, native-project 4/5, untrusted 2/2, trusted-vsix 2/2 (passing/pending). Adding a test means updating `integration-expected.json`.

Measured wall time, from `just test-integration-docker` with a warm image: 82 s sharded, against 141 s for the host run. Three further consecutive runs took 86 s, 113 s and 239 s. The 239 s run rebuilt the last image layers after a Dockerfile edit, so it is not a steady-state figure. Per-label seconds in the 86 s run: trusted 75, native-baseline 56, native-strict 38, native-project 35, symlinked 4, untrusted 3, trusted-vsix 3. In the 113 s run the native labels took 50 to 63 s, so the four containers compete for the 6 CPUs and the shard times vary by about 20 s between runs. `trusted` is the longest label and bounds the wall time; the host build before the shards takes about 15 s.

Image: 3.44 GB on disk, 849 MB of compressed content. A cold build (`--no-cache`, base image present) takes 4 min 41 s, of which the mise downloads of Node and Fusion and the VS Code download are the largest parts. A build with every layer cached takes 3 s. The tag is a content hash of the Dockerfile, `fetch-vscode.mjs`, `integration-layout.mjs`, `mise.toml`, `mise.lock`, `package.json` and `package-lock.json`, so workspaces with different inputs do not share a tag.

Linux-specific findings:

- Electron refuses to start as root without `--no-sandbox`, which the VSIX launches do not pass. The container therefore runs as the non-root user `tester`. As a non-root user, Chromium needs unprivileged user namespaces, which Docker's default seccomp profile blocks, so each `docker run` passes `--security-opt seccomp=unconfined`. Setting the setuid `chrome-sandbox` helper up as root was tried and does not work without `CAP_SYS_ADMIN`. With this, `untrusted` and `trusted-vsix` both pass in the container (2 passing and 2 pending each) with the sandbox enabled.
- Tests run `dbt` from `PATH` (`checkFusionVersion` in `src/test/integration/helpers/testFixtures.ts`), and a mise shim fails outside a directory with `mise.toml`, so the suite skips silently. The image puts a symlink to the real Fusion binary first on `PATH`, and the parity gate catches a skip.
- `mise install --locked` now verifies the Fusion linux-arm64 download: `mise.lock` carries the sha256 of the asset it names (`shasum -a 256` of `fs-v2.0.6-aarch64-unknown-linux-gnu.tar.gz`), and `just lint-mise-lock` passes.
- Chromium prints `dbus` and GPU `CreateCommandBuffer` errors under Xvfb with no system bus; they are harmless here.
- `npm ci` on the host-built checkout is not needed: the compiled output is plain JavaScript, so the host build is shared with every shard.

Test changes, each a race or gap in the test that the Linux run exposed:

- `src/test/integration/lspProtocolClient.ts`: the fixture client answered `client/registerCapability` but not `workspace/codeLens/refresh`, so a server request for it was recorded as an error and `lineageProgressRetention` failed its `getErrors().length === 0` assertion on every Linux run. The macOS run does not see the request within the test's window. The client now answers it with `null`, as it does for `client/registerCapability`. The assertion also prints the captured errors.
- `src/test/integration/columnLineage.test.ts`: "answers concurrent upstream and downstream requests for one column" wrote a model and queried at once. The server cancels in-flight requests to reanalyze the written file, and the product retries a cancelled request only once, so the test failed in about half of the Linux runs. The test now reissues the pair, for up to 60 s, while either answer is "Operation cancelled". Every edge assertion is unchanged.

## Alternatives the thesis missed

[high] Use Linux containers first for a measured integration pilot, but do not call them a replacement for smoke. Build one private writable worktree per shard, run one selected label under Xvfb, and fix `prepareLabel` to prepare only selected labels before scaling out. This addresses the actual all-label preparation and shared-output defects rather than multiplying them.

- [m1](../../scripts/test/integration-layout.mjs): "export const LABELS = [ "trusted", "symlinked", "native-strict", "native-baseline", "native-project", ];"
- [m2](../../scripts/test/integration-layout.mjs): "export const VSIX_LABELS = [UNTRUSTED_LABEL, TRUSTED_VSIX_LABEL];"

[high] Make test-electron’s cache an explicit shared read-only image/cache volume or add a runner option for a cache path. Otherwise every copied worktree has a distinct `.vscode-test` directory and the purported prebuilt VS Code layer is bypassed.

- [m3](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/download.ts): "cachePath = defaultCachePath,"
- [m4](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/download.ts): "const downloadedPath = path.resolve(cachePath, makeDownloadDirName(platform, version));"

[high] Preserve macOS smoke fidelity either by running the two host suites on separate private macOS worktrees on the host, or by using up to two preconfigured Tart guests after explicitly bootstrapping an unlocked login keychain and persistent GUI session. Do not make Lima macOS guests the primary route while its own documentation calls them experimental.

- [m5](../../scripts/smoke/run-host-smoke.sh): "if [[ -z "$vsix" ]]; then # A local run always smokes the working copy; CI passes the checksum-verified artifact with --vsix. (cd "$repo_root" && just package)"

[high] Create a Linux smoke port as a separate engineering project, not as an image-only change: add a Linux pin manifest; implement Linux host paths, archive extraction, checksum/product validation, and Xvfb launch; then run it as supplementary coverage. The existing scripts are intentionally Darwin-only and package formats are DMG/App bundles.

- [m7](../../scripts/smoke/pins.env): "FPU_VSCODE_PLATFORM=darwin-arm64"
- [m8](../../scripts/smoke/fetch-vscode.sh): "mv "$staging/Visual Studio Code.app" "$dest/Visual Studio Code.app""
- [m9](../../scripts/smoke/fetch-cursor.sh): "ditto "$app_src" "$dest/Cursor.app""

## Open questions

- Does a Cursor 3.21.16 linux-arm64 AppImage exist at a stable versioned URL? If so, what are its sha256 and product.json commit/vscodeVersion, and do they match the darwin pin?
- Does `xvfb-run -a npm run test:integration -- --label trusted` pass in a debian bookworm arm64 container with Fusion 2.0.6 glibc, and how long does each label take there compared with macOS?
- Where is /tmp/fpu-heavy.lock taken: user-level git hooks, agent tooling, or a repo file I did not read? A repo-wide grep would answer this.
- How many concurrent Electron+Fusion shards fit in Colima at 6 CPU / 16 GiB before timings degrade or the 30 s mocha timeouts fire, and how does that change if Colima is resized to about 12 CPU / 40 GiB?
- Do two concurrent macOS smoke runs on one host (separate worktrees) stay stable, given window focus and occlusion, the 10-iteration benchmark loop, and the shared pinned-host cache under ~/Library/Caches?
- Does fetch-host.sh tolerate two concurrent first-time fetches into the same host cache, or does the cache need to be pre-warmed or locked?
- How large is a configured Tart guest clone on disk, and how long does it take to boot to a GUI session ready for smoke on this Mac?

## Rejected citations

- antithesis m6 (<https://tart.run/faq/>): quote not found in the source: "Without an existing and unlocked login.keychain, the VM won't start with errors like:"
