# Research

## Question

Our VS Code/Cursor extension's smoke and integration tests fail intermittently, and we cannot say why from what they record. What diagnostics should the test harness and CI capture so that every such failure explains itself (logs, stack traces, timelines, CDP/webview traces, extension host and renderer logs, screenshots, process state), and how should each be wired into this repo?

## Recommendation

Two of the brief's readings are wrong, and the two webview failures have different causes. The Cursor docs failure happened in the first wait, before any edit or hide: the page opened already dirty with ' smoke draft'. The likeliest cause is the host's in-memory draft left over from documentationEditorInteractions. The vscode query failure did go through waitForPanelGone, and its final page looks like the one created at the start of the test, so two explanations remain open: a false 'gone', or a webview release() that never cleared the page. In the Docker 'cursor ok' case it was actually vscode that failed, and the exit status was correct. Land the cheap changes first, in this order. (1) Give every waitFor* call a label, and log each poll's wall time, iframe target list, frame evaluated, any swallowed error, timeOrigin and returned state. Make waitForPanelGone return a reason as well as a time (cdpClient.ts, panelViewState.test.ts). (2) Launch every host with --logsPath, --crash-reporter-directory and --log <publisher.name>:trace, pointing to a per-step directory that cleanup does not delete. (3) Add a fail hook in runTests.ts, and a JSON reporter in .vscode-test.mjs, that writes error.json and a CDP screenshot to failures/<test>/. (4) Tee host stdout/stderr through runTests' stream options with in-process timestamps. In docker-smoke.sh, keep each host's log under $out and print from the 'N failing' line instead of tail -60. (5) In ci.yml, add one `if: failure()` upload-artifact step per smoke job with short retention, and a step summary listing each failing test's title, the wait that failed, its last state and a link to the screenshot. (6) Add a watchdog to run-integration.mjs that captures `code --status`, /proc or sample output and a CDP screenshot before SIGKILLing the group, plus an `after` hook that lists dirty documents and tabs, to test the save-prompt theory. (7) Add host-side logs, with timestamps, of saveDraft and transmitData and of view visibility changes. (8) Build a browser-level CDP flight recorder in run-smoke.mjs that keeps recording when the extension host is blocked. Don't add gdb to the images; /proc, `code --status` and CDP screenshots cover the same need. As the brief asks, don't change retries, timeouts or skips.

## Points

| Point                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Verdict    | Confidence |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| 1. The code does what the thesis says. evaluatePanel catches any evaluation error and moves on to the next frame. waitForPanelGone returns only an elapsed time once no frame answers with the entry. So a probe fault, an empty /json/list iframe list and a real teardown all look the same. The antithesis is right that skipping errors is intended, because a context destroyed in the middle of a call is real evidence of teardown. The defect is that the helper records neither the skipped error nor the reason it returned. The thesis also undersold how much this matters. The vscode-376 stack shows the failing test got past waitForPanelGone and failed in the later `after` wait, so this helper did report 'gone' in the failing run. A false 'gone' is one of the live explanations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | middle     | high       |
| 2. A 'gone' time of a few milliseconds is believable. These panels are WebviewViewProviders, and hiding a non-retained view calls OverlayWebview.release(), which clears the inner webview synchronously. The same function returns early without clearing if the caller no longer owns the webview, so the old page can survive with its old timeOrigin. The measured time is about one or two /json/list polls. It doesn't show which page was destroyed, or that any page was.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | antithesis | medium     |
| 3. None of the three panels sets retainContextWhenHidden. The current architecture doc and the October research doc both say so, so the older audit doc and the test title 'opens retained panels' are out of date. Every real hide should therefore rebuild the page. The thesis named two cases: a page that wasn't rebuilt, or a probe reading the old page. The Cursor run adds a third: it failed before any hide happened (see 4). The vscode failure's last state, with 'Preview' active, is also odd. A page that survived the hide should still show 'SQL', so either something reset the tab or a rebuilt page failed to restore it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | middle     | medium     |
| 4. The logs correct the brief in three places. (a) In g6 the host that failed was vscode ('docker-smoke: vscode FAILED (exit 1)'), and Cursor passed. The exit status was correct, and the failing test's name and error are in the printed tail -60. What is lost is everything above those 60 lines, plus the whole log of any host that passed, because $work is deleted. (b) The 9 ms and 6 ms gone times both come from tests that passed. Neither failing test logged a goneMs. (c) The Cursor docs failure is at panelViewState.test.js:183:24. That is the first wait (`loaded`, which needs !modified), before any edit or hide, and the page opened already dirty with ' smoke draft'. So it is not a hide/show failure. The vscode query failure is at :163:23, the `after` wait, so its hide/show did run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | antithesis | medium     |
| 5. Logging the frame, targetId and timeOrigin on every poll is the right trace. The cheaper and more urgent fix is to give each waitFor, waitForTabs and waitForDocs call its own label. waitForDocs uses one fixed message for all three docs waits, so today only the compiled line number tells you which predicate failed. The thesis's 'needs a new timeOrigin' argument applies only to the `after` waits, and the Cursor failure was in the `loaded` wait. The `modified` flag is a substring match on the body text, so the trace should record it too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | middle     | high       |
| 6. The gap covers the whole harness, not a few tests. The view-state JSON is printed only after every wait passes. The smoke Mocha instance has no failure hook, and runTests rejects with only a count of failures. The fix is one root-level afterEach, or a runner.on('fail') listener in runTests.ts, that writes each failing test's full title, error, stack and last probe trace to a file. VS Code's own smoke suite uses the same shape: one hook per test that persists evidence only on failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | antithesis | high       |
| 7. No screenshot is taken when a test fails. Even the success-checkpoint PNG/JSON evidence is off in CI, because only the justfile visual-evidence recipe and Docker set FPU_SMOKE_SCREENSHOTS. A failure screenshot should use CDP Page.captureScreenshot on the workbench target, which the harness already does at checkpoints. It needs no X or macOS tools, and it should write to a failure directory that is always enabled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | middle     | high       |
| 8. Cleanup deletes the userData directory, which is where the logs live. The cheaper fix is the one upstream uses: launch with --logsPath and --crash-reporter-directory pointing outside the directories that cleanup removes, so the logs survive. Add --log trace, or the per-extension form, for this extension. Today the launch arguments set none of these.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | middle     | high       |
| 9. The smoke watchdog does keep a dump. It prints the host's ps lines and the last 80 lines of every log, with renderer, exthost and Fusion first. On darwin it also runs `sample` on the two busiest processes. It runs cleanup only after that. The real gaps are these: everything goes to stderr only; there is no CDP target list or screenshot; there is no source of stacks on Linux; and it exits 124 without signalling the host's process group.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | antithesis | high       |
| 10. `ps` is present in the Docker smoke image. gdb, eu-stack, xwd and ImageMagick's `import` are not. On Linux, get stacks and window state from /proc/<pid>/{status,wchan,stack} and `code --status`, and screenshots from CDP, rather than installing gdb. CI runs on macOS, where `sample` already exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | antithesis | high       |
| 11. CI keeps no diagnostics. The only upload-artifact step publishes the VSIX, and each smoke job runs six `just smoke-*` steps per host with no artifact step. A single `if: failure()` upload needs a separate output directory for each step, keyed by host and fixture, so the six steps don't overwrite each other. Today the raw CI stdout is the only record kept, and it located the failing waits only through compiled stack line numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | thesis     | high       |
| 12. run-integration.mjs starts the child as a process-group leader and SIGKILLs the group once the child exits. It has no timer, so a host that never exits, as in the 'trusted' hang, is never caught. Two additions are needed: a watchdog that dumps state before killing, and a root-level `after` hook that logs dirty textDocuments and dirty tabGroups tabs before shutdown. That hook would confirm or rule out the save-prompt theory in one run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | middle     | high       |
| 13. Upstream patterns worth copying: a separate logs and crashes directory for each suite; tracing turned on automatically when GITHUB_WORKSPACE is set; an afterEach that keeps the trace and takes a screenshot only for failed tests; and a log line when a kill is forced. Upstream drives Electron through Playwright, while this repo drives CDP by hand, so copy the hook structure rather than Playwright tracing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | middle     | high       |
| 14. @vscode/test-electron calls killTree only from its second-Ctrl+C handler. On a normal exit it simply resolves or rejects, and nothing in it kills a host that never exits. The thesis missed the useful option: runTests accepts stdout and stderr writable streams. Teeing those to a timestamped file is the cheapest durable record of host output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | antithesis | high       |
| 15. test-cli's config accepts one or more Mocha reporters, and .vscode-test.mjs sets only ui, timeout and color. Adding a file reporter (JSON or JUnit alongside spec) to the integration labels is therefore a config-only change. The smoke runner builds its own `new Mocha(...)`, so it needs a reporter option or a fail listener added in runTests.ts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | antithesis | high       |
| 16. Each failing test should produce one bundle at `<out>/<host>/<fixture>/failures/<test-slug>/` containing: error.json (title, which wait failed, its predicate, error, stack); probe.jsonl (one line per poll with wall time, the iframe target list with id/url/title, the frame evaluated, any swallowed error, timeOrigin and the returned state); a CDP screenshot; the webview's console messages and exceptions; the host's dirty documents; and pointers into the --logsPath directory (main, renderer, exthost and the extension's output channel). The per-step directory also holds host.log (teed stdout/stderr) and, on a hang, watchdog.txt (ps, /proc or sample output, `code --status`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | middle     | medium     |
| 17. Ranked plan, cheapest high-value changes first. (1) Give every waitFor* call a label that appears in its error, and add a `reason` and a poll log to waitForPanelGone and evaluatePanel (panelViewState.test.ts, cdpClient.ts). (2) Pass --logsPath, --crash-reporter-directory and --log <publisher.name>:trace, pointing to a per-step directory outside userData (run-smoke.mjs; .vscode-test.mjs launchArgs for integration). (3) Add a fail hook in runTests.ts that writes error.json and a CDP screenshot, and add a JSON file reporter in .vscode-test.mjs. (4) Tee runTests' stdout/stderr to host.log with timestamps. In docker-smoke.sh, keep each host's log under $out and print from the 'N failing' line instead of tail -60. (5) In ci.yml, add one `if: failure()` actions/upload-artifact step per smoke job for the per-step directories, with short retention. Add a $GITHUB_STEP_SUMMARY listing each failing test's title, the wait that failed, its last state and a link to the screenshot. (6) Add an integration watchdog to run-integration.mjs that captures `code --status`, /proc or sample output and a CDP screenshot, then SIGKILLs the group, plus the dirty-documents `after` hook. (7) Add an out-of-process CDP flight recorder to run-smoke.mjs (see 18). (8) Add host-side instrumentation for docs drafts and view visibility (see 19). Drop the step that installs gdb. | middle     | medium     |
| 18. Every CDP event a webview lifecycle recorder needs is defined in the protocol: Target.targetCreated, targetDestroyed and targetCrashed; Runtime.executionContextCreated and executionContextDestroyed; Runtime.exceptionThrown; Runtime.consoleAPICalled; and Page.frameNavigated. The recorder belongs in the launcher (run-smoke.mjs), connected at the browser level with Target.setDiscoverTargets, so it outlives a blocked extension host. It should write timestamped JSONL that both the fail hook and the watchdog flush.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | antithesis | high       |
| 19. The most likely source of the dirty Cursor docs page is the host's in-memory drafts, not webview state. The docs host keeps unsaved drafts in memory and sends the stored draft with every renderDocumentation. The page clears the host's copy with a fire-and-forget saveDraft once it is no longer dirty. The earlier suite, documentationEditorInteractions, types ' smoke draft' and then waits only for the page to report clean; it never checks that the host's map is empty. If that clearing message is lost or arrives late, the next docs page receives ' smoke draft' and opens dirty, which is exactly the failing state. The suite's own comment already notes that a dirty editor can leak between suites. The cheap diagnostic: log each host saveDraft and transmitData with a timestamp and the draft keys, and check at the end of each suite that the host holds no drafts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | new        | low        |
| 20. In vscode-376 the final query page was probably the one created at the start of the test. Its timeOrigin, 1792471285620.4, is about 04:41:25.6 UTC, and the next test's docs page loaded about 32 s later, which is roughly one full 120 × 250 ms wait. If so, the page was not rebuilt even though waitForPanelGone returned. It then showed 'Preview' instead of the 'SQL' it had held, which fits the host sending its last result again to a page that survived. That points either to a false 'gone' (point 1) or to a release() that returned without clearing (point 2), followed by a tab reset when the result was replayed. The probe log in plan step 1 would settle it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | new        | low        |
| 21. For VS Code runs in CI, the log's timestamps can't be used to build a timeline. In vscode-376, every Mocha line from 'reports host runtime versions' to the failure summary has the same timestamp, 04:42:00.8, so the host's output reached the runner in one batch at the end. Cursor's log is timestamped as it runs. Timestamps therefore have to be taken inside the process: Date.now() in the probe log, the fail hook and the teed host.log. CI timestamps can't be trusted to order events.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | new        | low        |

## Detail

### 1. The code does what the thesis says. evaluatePanel catches any evaluation error and moves on to the next frame. waitForPanelGone returns only an elapsed time once no frame answers with the entry. So a probe fault, an empty /json/list iframe list and a real teardown all look the same. The antithesis is right that skipping errors is intended, because a context destroyed in the middle of a call is real evidence of teardown. The defect is that the helper records neither the skipped error nor the reason it returned. The thesis also undersold how much this matters. The vscode-376 stack shows the failing test got past waitForPanelGone and failed in the later `after` wait, so this helper did report 'gone' in the failing run. A false 'gone' is one of the live explanations

Verdict: middle. Confidence: high.

I read cdpClient.ts:312-381. The catch-and-continue, the bare elapsed time and the iframe-only target filter are all there. cdpEvaluation.ts raises the 'destroyed' error on purpose. The vscode-376 log puts the failing frame at panelViewState.test.js:163:23. In the compiled file, line 163 is the `after` wait, which runs after the waitForPanelGone call on line 160. The log itself can't be cited, so the compiled line is the citation.

Citations:

- r1a (cdpClient.ts, before the split): "for (const frame of await panelFrames(port)) {"
- r1b (cdpClient.ts, before the split): "if (!(await evaluatePanel(port, entry, probe))) {"
- r1c (cdpClient.ts, before the split): "target.type === "iframe" && target.webSocketDebuggerUrl"
- [r1d](../../src/test/smoke/cdpEvaluation.ts): "was destroyed before evaluation completed"
- [r1e](../../src/test/smoke/panelViewState.test.ts): "const after = await waitForTabs(port, (tabs) => tabs.timeOrigin !== selected.timeOrigin &&"

Thesis (high): waitForPanelGone reports 'gone' as soon as evaluatePanel finds no matching entry. evaluatePanel loops over every frame from panelFrames and does not separate 'no match' from 'evaluation threw', so a probe fault on a stale or destroyed frame looks identical to a real teardown. The recorded goneMs cannot tell these apart, and the probe does not record which frame it matched.

Thesis citations:

- c1 (cdpClient.ts, before the split): "for (const frame of await panelFrames(port)) {"
- c2 (cdpClient.ts, before the split): "if (!(await evaluatePanel(port, entry, probe))) {"
- c3 (cdpClient.ts, before the split): "return Date.now() - started;"

Antithesis: The thesis says a swallowed probe fault could look like a real teardown. That is true of the code, but it never connects it to the evidence. In the vscode-376 failure the final reads were answered by a live frame (the last state has 'active: Preview…' and a timeOrigin). So the failure was not a probe that cannot reach the frame. The open question is whether the earlier 'gone' return was false, and the thesis cannot answer it, because no failing wait logs its polls.

Antithesis: It misses the other half of the helper. `waitForPanelGone` never records how many iframe targets `/json/list` returned or which ones it evaluated. A 'gone' from zero iframe targets and a 'gone' from a swallowed evaluation error are indistinguishable, because both log only a bare `goneMs`.

Antithesis: The 'wait helper reads a stale target' framing assumes `/json/list` can lag. The thesis offers nothing for that, and it never looks at the VS Code side, where hiding is a synchronous `release()` guarded by an ownership check (see point 2).

Antithesis: The thesis treats `evaluatePanel`'s catch-and-continue as the main defect. It is a deliberate tolerance: `evaluateContexts` throws 'context … was destroyed before evaluation completed' on purpose during a rebuild. For `waitForPanelGone` that error is legitimate evidence of teardown. The defect is not the swallowing. It is that nothing records the swallowed error or the reason the helper returned.

Counter-evidence:

- [k1](../../src/test/smoke/cdpEvaluation.ts): "was destroyed before evaluation completed"
- k2 (cdpClient.ts, before the split): "target.type === "iframe" && target.webSocketDebuggerUrl"

### 2. A 'gone' time of a few milliseconds is believable. These panels are WebviewViewProviders, and hiding a non-retained view calls OverlayWebview.release(), which clears the inner webview synchronously. The same function returns early without clearing if the caller no longer owns the webview, so the old page can survive with its old timeOrigin. The measured time is about one or two /json/list polls. It doesn't show which page was destroyed, or that any page was

Verdict: antithesis. Confidence: medium.

In overlayWebview.ts, release() has the ownership guard and then calls clear() when retainContextWhenHidden is off. architecture.md confirms the panels are WebviewViewProviders. The webview guide's sentence about destroying hidden content is still true in general, but it is the weaker source. I haven't traced WebviewViewPane's hide path to release() line by line.

Citations:

- [r2a](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/webview/browser/overlayWebview.ts): "if (this._owner !== owner) {"
- [r2b](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/webview/browser/overlayWebview.ts): "this._webview.clear();"
- [r2c](../architecture.md): "Each registers as a `WebviewViewProvider`."
- [r2d](https://code.visualstudio.com/api/extension-guides/webview): "The contents of webviews however are created when the webview becomes visible and destroyed when the webview is moved into the background."

Thesis (medium): A 6 to 10 ms 'gone' time is plausible as a normal teardown. The webview guide says a non-retained webview's content is created when visible and destroyed when moved to the background, so a fast disappearance is expected behaviour, not evidence of a stale target. Whether the spike's 6 to 10 ms values are normal or not cannot be checked from the logs here, because the log files could not be cited.

Thesis citations:

- [c9](https://code.visualstudio.com/api/extension-guides/webview): "The contents of webviews however are created when the webview becomes visible and destroyed when the webview is moved into the background."

Antithesis: The thesis is right that 6–10 ms is plausible, but its only support is a generic docs sentence. The VS Code source gives a stronger mechanism: hiding a non-retained webview calls `release()`, which clears the webview synchronously. A millisecond-scale 'gone' is therefore expected.

Antithesis: It misses the failure mode the same code allows. `release()` returns early unless the releasing view still owns the webview. If ownership moved (another view claimed it, or a hide/show race), the page is never cleared. The old page then survives with its old timeOrigin, which is the vscode-376 symptom. The thesis frames this only as 'unrebuilt page or probe on the old page'.

Antithesis: Each `/json/list` fetch plus any live-frame evaluation costs a few ms, so 6–10 ms is the cost of one or two polls. It does not show that a particular page was destroyed in that time.

Antithesis: The thesis cites the webview guide for 'destroyed when moved into the background'. That guide covers webview panels. This repo's panels are registered as WebviewViewProviders (docs/architecture.md), and their hide path is `WebviewViewPane.updateTreeVisibility` → `OverlayWebview.release`, a different code path.

Counter-evidence:

- [k3](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/webview/browser/overlayWebview.ts): "if (this._owner !== owner) {"
- [k4](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/webview/browser/overlayWebview.ts): "this._webview.clear();"
- k5 (cdpClient.ts, before the split): "// Cursor can acknowledge Runtime.enable before reporting existing contexts."

### 3. None of the three panels sets retainContextWhenHidden. The current architecture doc and the October research doc both say so, so the older audit doc and the test title 'opens retained panels' are out of date. Every real hide should therefore rebuild the page. The thesis named two cases: a page that wasn't rebuilt, or a probe reading the old page. The Cursor run adds a third: it failed before any hide happened (see 4). The vscode failure's last state, with 'Preview' active, is also odd. A page that survived the hide should still show 'SQL', so either something reset the tab or a rebuilt page failed to restore it

Verdict: middle. Confidence: medium.

architecture.md:104 and webview-state-october-2026.md both say retain is off, and that the smoke test fails if it is turned on. The 'opens retained panels' wording in the vscode log is only a test name. The point about the odd final state comes from the log; point 20 works through it.

Citations:

- [r3a](../architecture.md): "VS Code discards a hidden page, and the rebuilt page restores its view state through"
- [r3b](webview-state-october-2026.md): "The test fails when `retainContextWhenHidden` is on, because the page is never rebuilt."

Thesis (medium): Panels in this harness do not set retainContextWhenHidden, so each hide and show rebuilds the page. The official webview guide says state survives only through getState and setState, and that retainContextWhenHidden keeps the page alive at high memory cost. The repo's architecture doc says the same about a hidden page being discarded and the rebuilt page restoring its state. So a query-tab or docs failure that survives a hide with the same page instance is either an unrebuilt page or a probe on the old page; the harness cannot tell which.

Thesis citations:

- [c10](../architecture.md): "VS Code discards a hidden page, and the rebuilt page restores its view state through"
- [c11](https://code.visualstudio.com/api/extension-guides/webview): "This state is persisted even after the webview content itself is destroyed when a webview panel becomes hidden."
- [c12](https://code.visualstudio.com/api/extension-guides/webview): "This option makes a webview keep its content around but in a hidden state, even when the webview itself is no longer in the foreground."
- [c13](https://code.visualstudio.com/api/extension-guides/webview): "keep in mind that this has high memory overhead and should only be used when other persistence techniques will not work"

Antithesis: The thesis says 'a failure that survives a hide with the same page instance is either an unrebuilt page or a probe on the old page; the harness cannot tell which'. It leaves out a third case that the logs favour: the Cursor docs failure probably never reached the hide at all (see point 4).

Antithesis: The vscode-376 final state, as I read it in /tmp/flaky-spike/vscode-376-query-tab.log, is 'active: Preview 3 rows…'. If the page were unrebuilt after the `selected` wait (active === SQL) passed, the active tab should still be SQL. So either the page was rebuilt and did not restore the SQL tab, which is a product bug, or something reset the tab on the same page. The thesis never notices that this state is internally odd. (The checker cannot open that log, so this is uncited and speculative.)

Antithesis: The thesis says panels do not set retainContextWhenHidden. The repo's research doc says the same, but an older audit doc says 'retainContextWhenHidden: true is set on all 3 view providers', and a test is titled 'opens retained panels'. The thesis does not check which is current.

Antithesis: The thesis takes 'the same timeOrigin as before hiding' from the task brief. The failing run never logs `selected`, because `FPU_SMOKE_VIEW_STATE` is printed only after the waits pass. Neither the thesis nor the log can confirm that the failing page equals the pre-hide page.

Counter-evidence:

- [k6](../../src/test/smoke/panelViewState.test.ts): "const after = await waitForTabs(port, (tabs) => tabs.timeOrigin !== selected.timeOrigin &&"
- [k7](../../src/test/smoke/panelViewState.test.ts): "const edit = `${base} smoke draft`;"

### 4. The logs correct the brief in three places. (a) In g6 the host that failed was vscode ('docker-smoke: vscode FAILED (exit 1)'), and Cursor passed. The exit status was correct, and the failing test's name and error are in the printed tail -60. What is lost is everything above those 60 lines, plus the whole log of any host that passed, because $work is deleted. (b) The 9 ms and 6 ms gone times both come from tests that passed. Neither failing test logged a goneMs. (c) The Cursor docs failure is at panelViewState.test.js:183:24. That is the first wait (`loaded`, which needs !modified), before any edit or hide, and the page opened already dirty with ' smoke draft'. So it is not a hide/show failure. The vscode query failure is at :163:23, the `after` wait, so its hide/show did run

Verdict: antithesis. Confidence: medium.

I grepped the three logs. In g6, line 3 is 'vscode FAILED', line 64 is 'cursor ok', and the test titles are on lines 15 and 40. The Cursor stack points to :183:24 and the vscode stack to :163:23. In the compiled out/ file, line 183 is `const loaded = await` and line 163 is `const after = await`. With eight spaces of indent, `await` starts at columns 24 and 23, which matches both stack columns exactly. The logs can't be cited, so the citations are the code those lines map to.

Citations:

- [r4a](../../src/test/smoke/panelViewState.test.ts): "const loaded = await waitForDocs(port, (docs) => docs.description !== null && !docs.modified);"
- [r4b](../../src/test/smoke/panelViewState.test.ts): "(docs) => docs.description !== null && !docs.modified,"
- [r4c](../../scripts/smoke/docker-smoke.sh): "echo "docker-smoke: ${hosts[$i]} FAILED (exit $host_status)" >&2"
- [r4d](../../scripts/smoke/docker-smoke.sh): "tail -60 "$work/${hosts[$i]}.log" >&2"
- [r4e](../../scripts/smoke/docker-smoke.sh): "echo "docker-smoke: FAIL (full logs in $work)" >&2"

Thesis (speculative): From the spike logs I read (not cited here, because the checker could not open them): the 6 ms goneMs in the cursor run is logged by the query-results test, which passed; the failing docs test never logged goneMs. The 9 ms goneMs in the vscode run is logged by the docs test, which passed; the failing query-tab test threw in waitForTabs before logging. So the brief's claim that the failing test's wait returned in about 9 ms is not supported. The cursor docs failure shows a matching description (' smoke draft') with an unchanged timeOrigin, and the vscode query-tab failure shows the same timeOrigin before and after hiding. These point to the page not being rebuilt, or to the probe reading the old page. The Docker smoke run printed 'docker-smoke: vscode FAILED (exit 1)' and 'cursor ok' with a failing test whose name was not kept, so the exit status was right but the failure detail was lost.

Antithesis: The thesis could not open the logs and marked everything speculative. I read them locally, and two of its conclusions change. The checker cannot fetch /tmp paths, so the log-derived facts below are uncited. Each is paired with the repo code that shows the same thing.

Antithesis: (1) The g6 log does not show 'Cursor reported 1 failing but exited ok'. In my reading, the failing run is the vscode host: its FPU_SMOKE_RUNTIME line says host vscode, and the log's first line is 'docker-smoke: vscode FAILED (exit 1)'. The 'cursor ok' line is a passing Cursor run, and the script exits 1 on any failed host. Exit status propagated correctly.

Antithesis: (2) The thesis says the failing test's name 'was not kept'. In my reading it was: `docker-smoke.sh` prints the failed host's `tail -60`, and that tail contains the '1) Lineage grouping … groups the hub's children by folder' header and its full error. What is lost is everything before those 60 lines, and the whole log of any host that passes (the `$work` directory is deleted on success).

Antithesis: (3) The stack frames in the logs identify which wait failed, and the thesis missed them. The vscode query failure is at out/test/smoke/panelViewState.test.js:163:23. The Cursor docs failure is at :183:24. In the compiled test, line 163 is the `after` wait and line 183 is `const loaded = await waitForDocs(…)`, the first wait, before any edit or hide. `const loaded =` puts the `await` at column 24; `const after =` puts it at column 23. The last state in the Cursor log (description ' smoke draft', modified true) cannot satisfy the `loaded` predicate `description !== null && !modified`. The compiled file is a local build, and I checked that transpiling the current source gives the same line map.

Antithesis: So the Cursor docs failure is most likely not a hide/show failure. The docs page opened already dirty with the draft text, and the previous suite, documentationEditorInteractions.test.ts, types the same ' smoke draft' text. The 33 s between test start and failure fits a single 30 s `waitFor` plus open. The `modified` flag is a text sniff, `document.body.innerText.includes("modified")`. This would explain 'failed twice on the same commit, passed on stacked PRs': state or ordering leakage, not a race. Confidence is medium. It rests on the column arithmetic and an `out/` build with the same line map.

Antithesis: (4) The thesis is right that the 9 ms and 6 ms values belong to passing tests. In my reading, the 9 ms is logged by the passing docs test in the vscode run, and the 6 ms by the passing query test in the Cursor run. Neither failing test logged a `goneMs`.

Antithesis: The thesis states 'the brief's claim that the failing test's wait returned in about 9 ms is not supported' but leaves both failing waits unidentified. The stack text in the logs identifies them, and the thesis never reads it.

Counter-evidence:

- [k8](../../scripts/smoke/docker-smoke.sh): "echo "docker-smoke: ${hosts[$i]} FAILED (exit $host_status)" >&2"
- [k9](../../scripts/smoke/docker-smoke.sh): "echo "docker-smoke: ${hosts[$i]} ok""
- [k10](../../scripts/smoke/docker-smoke.sh): "echo "docker-smoke: FAIL (full logs in $work)" >&2"
- [k11](../../src/test/smoke/panelViewState.test.ts): "const loaded = await waitForDocs(port, (docs) => docs.description !== null && !docs.modified);"
- [k12](../../src/test/smoke/panelViewState.test.ts): "(docs) => docs.description !== null && !docs.modified,"
- [k13](../../src/test/smoke/documentationEditorInteractions.test.ts): "const edit = `${original} smoke draft`;"
- [k14](../../src/test/smoke/webviewInteractions.ts): "modified: document.body.innerText.includes("modified"),"
- [k15](../../scripts/smoke/docker-smoke.sh): "tail -60 "$work/${hosts[$i]}.log" >&2"

### 5. Logging the frame, targetId and timeOrigin on every poll is the right trace. The cheaper and more urgent fix is to give each waitFor, waitForTabs and waitForDocs call its own label. waitForDocs uses one fixed message for all three docs waits, so today only the compiled line number tells you which predicate failed. The thesis's 'needs a new timeOrigin' argument applies only to the `after` waits, and the Cursor failure was in the `loaded` wait. The `modified` flag is a substring match on the body text, so the trace should record it too

Verdict: middle. Confidence: high.

In the files I read, waitForDocs passes a single message string, and modified is computed as document.body.innerText.includes("modified").

Citations:

- [r5a](../../src/test/smoke/panelViewState.test.ts): ""the documentation editor never matched","
- [r5b](../../src/test/smoke/webviewInteractions.ts): "modified: document.body.innerText.includes("modified"),"
- [r5c](../../src/test/smoke/panelViewState.test.ts): "docs.timeOrigin !== edited.timeOrigin && docs.description === edit,"

Thesis (medium): The docs predicate needs both a new timeOrigin and a matching description. If the page is not rebuilt, the predicate can never match, and the wait fails with no record of which frame it read. Logging each poll's frame id, targetId and timeOrigin would show whether the wait read the old page.

Thesis citations:

- [c14](../../src/test/smoke/panelViewState.test.ts): "docs.timeOrigin !== edited.timeOrigin && docs.description === edit,"

Antithesis: The thesis proposes logging each poll's frame id, targetId and timeOrigin. That is useful, but it misses the cheaper fix. The three wait helpers (`waitFor`, `waitForTabs`, `waitForDocs`) throw a message that does not say which call site's predicate failed. Today only the compiled stack line number identifies it, and that depends on the exact build.

Antithesis: The `modified` probe is a substring test on the body text, so any page text containing 'modified' flips it. A per-poll trace would show the flip, but the thesis does not flag the probe as a suspect.

Antithesis: The thesis says that if the page is not rebuilt, the `after` predicate can never match. That holds only for the `after` wait. For the Cursor failure the wait that failed is `loaded`, which needs `!modified`, not a new timeOrigin.

Counter-evidence:

- [k16](../../src/test/smoke/panelViewState.test.ts): "(docs) => docs.description !== null && !docs.modified,"

### 6. The gap covers the whole harness, not a few tests. The view-state JSON is printed only after every wait passes. The smoke Mocha instance has no failure hook, and runTests rejects with only a count of failures. The fix is one root-level afterEach, or a runner.on('fail') listener in runTests.ts, that writes each failing test's full title, error, stack and last probe trace to a file. VS Code's own smoke suite uses the same shape: one hook per test that persists evidence only on failure

Verdict: antithesis. Confidence: high.

runTests.ts:16-41 builds Mocha with only ui, timeout and color, and rejects with a count. Upstream utils.ts has an afterEach that logs FAILURE and keeps the trace only when the test failed.

Citations:

- [r6a](../../src/test/smoke/runTests.ts): "reject(new Error(`${failures} smoke test(s) failed.`));"
- [r6b](../../src/test/smoke/panelViewState.test.ts): "const goneMs = await waitForPanelGone(port, RESULTS.entry);"
- [r6c](https://raw.githubusercontent.com/microsoft/vscode/main/test/smoke/src/utils.ts): `await app?.stopTracing(testTitle.replace(/[^a-z0-9\-]/ig, '_'), failed);`

Thesis (high): Failure detail is not recorded. goneMs and the state line are written only after the wait and check succeed, so a failing test leaves no timing or state record. The only per-check data is a single final JSON line.

Thesis citations:

- [c15](../../src/test/smoke/panelViewState.test.ts): "const goneMs = await waitForPanelGone(port, RESULTS.entry);"
- [c16](../../src/test/smoke/panelViewState.test.ts): "`FPU_SMOKE_VIEW_STATE=${JSON.stringify({ host, goneMs, before, selected, after })}`,"

Antithesis: Right for the view-state tests, but it understates the gap. Mocha runs with no failure hook and the default reporter with ANSI colour. The smoke runner has no `runner.on('fail')` listener and no `afterEach` that records the failing test's title, error and stack. `runTests.ts` rejects with only 'N smoke test(s) failed'.

Antithesis: The thesis treats recording a final JSON line as a per-test problem. It should be a harness-wide hook, because writing state in each test only covers the tests someone edits.

Counter-evidence:

- [k17](../../src/test/smoke/runTests.ts): "reject(new Error(`${failures} smoke test(s) failed.`));"
- [k18](../../node_modules/mocha/lib/runner.js): "runner.on(EVENT_TEST_FAIL, function(test, err) {"
- [k19](https://raw.githubusercontent.com/microsoft/vscode/main/test/smoke/src/utils.ts): `await app?.stopTracing(testTitle.replace(/[^a-z0-9\-]/ig, '_'), failed);`

### 7. No screenshot is taken when a test fails. Even the success-checkpoint PNG/JSON evidence is off in CI, because only the justfile visual-evidence recipe and Docker set FPU_SMOKE_SCREENSHOTS. A failure screenshot should use CDP Page.captureScreenshot on the workbench target, which the harness already does at checkpoints. It needs no X or macOS tools, and it should write to a failure directory that is always enabled

Verdict: middle. Confidence: high.

justfile:299 and docker-smoke.sh:98 set the variable. ci.yml runs `just smoke-vscode ...` without it.

Citations:

- [r7a](../../justfile): "FPU_SMOKE_SCREENSHOTS="{{ out }}" just smoke {{ args }}"
- [r7b](../../src/test/smoke/panelSmoke.test.ts): "const png = await captureWorkbenchScreenshot(cdpPort, host);"
- [r7c](../../.github/workflows/ci.yml): "just smoke-vscode --vsix fusion-power-user-*.vsix --fixture src/test/fixtures/single-project"

Thesis (high): Failure-time screenshots are not taken. captureWorkbenchScreenshot runs only at success checkpoints, so a failing hide or show has no picture of the workbench or panel state at the moment of failure.

Thesis citations:

- [c17](../../src/test/smoke/panelSmoke.test.ts): "const png = await captureWorkbenchScreenshot(cdpPort, host);"

Antithesis: Right that there is no failure-time screenshot, but the thesis frames the gap too narrowly. Screenshots go through `FPU_SMOKE_SCREENSHOTS`, and only the Docker recipe sets it. CI never sets it, so the existing PNG and JSON evidence pipeline is off on macOS CI even for passing checkpoints. A failure-time capture needs that switch set (or a separate always-on failure directory) and an upload step, not only a new call.

Antithesis: For a CI hang the thesis's 'screenshot the X display' idea does not apply on macOS. `Page.captureScreenshot` over the existing CDP port needs no X tools, and the Docker image has no X screenshot tool either.

Counter-evidence:

- [k20](../../justfile): "FPU_SMOKE_SCREENSHOTS="{{ out }}" just smoke {{ args }}"

### 8. Cleanup deletes the userData directory, which is where the logs live. The cheaper fix is the one upstream uses: launch with --logsPath and --crash-reporter-directory pointing outside the directories that cleanup removes, so the logs survive. Add --log trace, or the per-extension form, for this extension. Today the launch arguments set none of these

Verdict: middle. Confidence: high.

run-smoke.mjs:112 calls rmSync on userDataDir. Lines 224-236 set only the data and extension dirs, the CDP port, the backgrounding flags and the Cursor flags. Upstream electron.ts passes both paths, and argv.ts documents the per-extension log level.

Citations:

- [r8a](../../scripts/smoke/run-smoke.mjs): "rmSync(userDataDir, { recursive: true, force: true });"
- [r8b](../../scripts/smoke/run-smoke.mjs): "`--remote-debugging-port=${cdpPort}`,"
- [r8c](https://raw.githubusercontent.com/microsoft/vscode/main/test/automation/src/electron.ts): "`--crash-reporter-directory=${crashesPath}`,"
- [r8d](https://raw.githubusercontent.com/microsoft/vscode/main/test/automation/src/electron.ts): "`--logsPath=${logsPath}`"
- [r8e](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/environment/node/argv.ts): "You can also configure the log level of an extension by passing extension id and log level in the following format: '${publisher}.${name}:${logLevel}'."

Thesis (high): The run-smoke cleanup deletes the userData, extensions and workspace directories, which hold the VS Code and extension logs. Logs must be copied out before cleanup or they are lost on failure.

Thesis citations:

- [c18](../../scripts/smoke/run-smoke.mjs): "rmSync(userDataDir, { recursive: true, force: true });"

Antithesis: Right that `cleanup` removes the userData directory, which contains the logs. The thesis recommends copying logs out first but does not mention the cheaper route that upstream uses: put the logs outside the throwaway directory with `--logsPath` and the crash dumps in a separate directory with `--crash-reporter-directory`. Then cleanup cannot delete them.

Antithesis: The repo's launch args set neither flag, nor `--log`. The only diagnostic flag is the CDP port.

Counter-evidence:

- [k21](https://raw.githubusercontent.com/microsoft/vscode/main/test/automation/src/electron.ts): "`--logsPath=${logsPath}`"
- [k22](https://raw.githubusercontent.com/microsoft/vscode/main/test/automation/src/electron.ts): "`--crash-reporter-directory=${crashesPath}`,"
- [k23](../../scripts/smoke/run-smoke.mjs): "`--remote-debugging-port=${cdpPort}`,"
- [k24](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/environment/node/argv.ts): "You can also configure the log level of an extension by passing extension id and log level in the following format: '${publisher}.${name}:${logLevel}'."

### 9. The smoke watchdog does keep a dump. It prints the host's ps lines and the last 80 lines of every log, with renderer, exthost and Fusion first. On darwin it also runs `sample` on the two busiest processes. It runs cleanup only after that. The real gaps are these: everything goes to stderr only; there is no CDP target list or screenshot; there is no source of stacks on Linux; and it exits 124 without signalling the host's process group

Verdict: antithesis. Confidence: high.

I read run-smoke.mjs:160-214.

Citations:

- [r9a](../../scripts/smoke/run-smoke.mjs): "out(lines.slice(-80).join("\n"));"
- [r9b](../../scripts/smoke/run-smoke.mjs): "for (const [pid, , cpu] of process.platform === "darwin" ? busiest : []) {"
- [r9c](../../scripts/smoke/run-smoke.mjs): "// Mocha's own timeout runs inside the extension host, so a blocked host never reports it."

Thesis (medium): The smoke host watchdog is the only hang guard for the smoke runner, and it runs in the runner process, not in the extension host. Its comment says Mocha's own timeout runs inside the extension host, so a blocked host never reports it. The watchdog runs cleanup and exits with code 124, but does not signal the host process tree itself.

Thesis citations:

- [c19](../../scripts/smoke/run-smoke.mjs): "// Mocha's own timeout runs inside the extension host, so a blocked host never reports it."
- [c20](../../scripts/smoke/run-smoke.mjs): "const HOST_WATCHDOG_MS = Number(process.env.FPU_SMOKE_WATCHDOG_MS ?? 240_000);"

Antithesis: The thesis summary says the hang guard 'keeps no dump'. For the smoke runner that is wrong. The watchdog prints the host process listing and the last 80 lines of each log (renderer, exthost, Fusion and dbt logs first), and on darwin it runs `sample` on the two busiest host processes. All of that goes to the CI log, and cleanup runs only after it.

Antithesis: The real defects are different: (a) the dump goes to stderr only, and the default 240 s fires before the per-suite 300 s Mocha timeouts; (b) there is no CDP screenshot or target listing at watchdog time; (c) it never signals the host; (d) the Linux path has no stack dump, because `sample` is gated on darwin.

Antithesis: The smoke watchdog exists only in `run-smoke.mjs`. The integration runner has no equivalent, and the thesis does not make that contrast.

Antithesis: The thesis reads 'does not signal host process tree itself' as a flaw in the dump. It is a flaw in cleanup, not in diagnostics. An orphaned Electron host after `process.exit(124)` is a CI-time cost, not a missing artifact.

Counter-evidence:

- [k25](../../scripts/smoke/run-smoke.mjs): "FPU_SMOKE_WATCHDOG: ${host} did not finish within ${HOST_WATCHDOG_MS} ms"
- [k26](../../scripts/smoke/run-smoke.mjs): "out(lines.slice(-80).join("\n"));"
- [k27](../../scripts/smoke/run-smoke.mjs): "for (const [pid, , cpu] of process.platform === "darwin" ? busiest : []) {"

### 10. `ps` is present in the Docker smoke image. gdb, eu-stack, xwd and ImageMagick's `import` are not. On Linux, get stacks and window state from /proc/<pid>/{status,wchan,stack} and `code --status`, and screenshots from CDP, rather than installing gdb. CI runs on macOS, where `sample` already exists

Verdict: antithesis. Confidence: high.

I ran `docker run fpu-smoke:75d64eb719fb`. It printed /usr/bin/ps and procps-ng 4.0.2, and found no gdb, eu-stack, xwd or import. A package list alone could not show this. It is a local command result, so it is not cited.

Citations:

- [r10a](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/environment/node/argv.ts): "Print process usage and diagnostics information."
- [r10b](../../docker/integration/Dockerfile): "python3 perl git curl ca-certificates unzip xz-utils fonts-dejavu-core"

Thesis (medium): The watchdog's process listing and stack sampling depend on tools that the Docker image may lack. The Docker integration package list I read does not include procps or gdb, so ps may fail in Docker runs, and macOS-only sample calls are gated on darwin. The Linux stack-dump path is therefore absent in Docker.

Thesis citations:

- [c21](../../scripts/smoke/run-smoke.mjs): "const ps = spawnSync("ps", ["-eo", "pid,ppid,pcpu,etime,command"], {"
- [c22](../../docker/integration/Dockerfile): "python3 perl git curl ca-certificates unzip xz-utils fonts-dejavu-core"

Antithesis: The thesis infers that `ps` may be missing in the Docker image because the package list omits procps. I ran the built smoke image (fpu-smoke:75d64eb719fb): `/usr/bin/ps` exists (procps-ng 4.0.2). This is a local command result, not a citable file. The watchdog's `ps.stdout.split` and `assertNoSurvivingFusionLspProcess` both rely on it, and Docker smoke runs pass.

Antithesis: In the same image, gdb, eu-stack, strace, xdotool and xwd are missing. So the Linux stack-dump gap is real, but the right fix is not an apt-get of gdb for Electron. `/proc/<pid>/{status,wchan,stack,task/*/comm}` and `code --status` need nothing installed, and a CDP `Page.captureScreenshot` replaces any X tool.

Antithesis: The Docker image is local only. CI runs on macos-latest, where `sample` already exists, so Linux-only tooling does nothing for CI failures.

Antithesis: The thesis rests 'ps may fail in Docker' on a package list. Package lists do not show what a base image already pulls in.

Counter-evidence:

- [k28](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/environment/node/argv.ts): "Print process usage and diagnostics information."

### 11. CI keeps no diagnostics. The only upload-artifact step publishes the VSIX, and each smoke job runs six `just smoke-*` steps per host with no artifact step. A single `if: failure()` upload needs a separate output directory for each step, keyed by host and fixture, so the six steps don't overwrite each other. Today the raw CI stdout is the only record kept, and it located the failing waits only through compiled stack line numbers

Verdict: thesis. Confidence: high.

check-and-package.yml:53-56 uploads fusion-power-user-vsix. ci.yml:60-183 contains only run steps for the smoke tests.

Citations:

- [r11a](../../.github/workflows/check-and-package.yml): "name: fusion-power-user-vsix"
- [r11b](../../.github/workflows/ci.yml): "just smoke-vscode --vsix fusion-power-user-*.vsix --fixture src/test/fixtures/single-project"

Thesis (high): The CI workflow uploads no diagnostics. The upload-artifact step I read publishes only the VSIX, and the smoke jobs carry a 45-minute timeout. A hang or failure therefore ends with no logs, screenshots or process dump kept.

Thesis citations:

- [c23](../../.github/workflows/check-and-package.yml): "name: fusion-power-user-vsix"
- [c24](../../.github/workflows/ci.yml): "runs-on: macos-latest timeout-minutes: 45"

Antithesis: Right that CI uploads no diagnostics, but the evidence cited is thin. The check-and-package job uploads the VSIX, and the smoke jobs in ci.yml have no artifact step. The thesis does not note that each smoke job runs six fixture steps per host, so one failure-only upload needs per-step directories.

Antithesis: It does not mention that what CI keeps is the raw stdout. The Cursor and vscode CI logs contained compiled-test stack frames, which is how this review could identify the failing waits.

Counter-evidence:

- [k29](../../.github/workflows/check-and-package.yml): "uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2"

### 12. run-integration.mjs starts the child as a process-group leader and SIGKILLs the group once the child exits. It has no timer, so a host that never exits, as in the 'trusted' hang, is never caught. Two additions are needed: a watchdog that dumps state before killing, and a root-level `after` hook that logs dirty textDocuments and dirty tabGroups tabs before shutdown. That hook would confirm or rule out the save-prompt theory in one run

Verdict: middle. Confidence: high.

I read run-integration.mjs:65-80 and 183-196. The dirty-document hook is a design proposal and has not been tested.

Citations:

- [r12a](../../scripts/test/run-integration.mjs): "child.on("exit", (exitCode) => {"
- [r12b](../../scripts/test/run-integration.mjs): "// The child leads its own process group, so this reaches the VS Code host and its helpers."

Thesis (medium): The Docker integration runner waits for the child process's exit event and sets no timeout or watchdog of its own, so a child that never exits, such as the 'trusted' case where all tests passed and the process did not exit, is not caught by the runner.

Thesis citations:

- [c25](../../scripts/test/run-integration.mjs): "child.on("exit", (exitCode) => {"

Antithesis: Right that the integration runner has no timeout of its own. But the thesis omits what the runner does: the child is a process-group leader and its group is SIGKILLed once it exits. The gap is specifically that the child never exits. That is what a watchdog must handle.

Antithesis: 'Passed all tests then never exited' matches a modal 'save changes?' prompt on quit, but no probe in the repo checks for it. A cheap check is a root-level `after` hook that logs `vscode.workspace.textDocuments.filter(d => d.isDirty)` and the dirty tabs in `vscode.window.tabGroups`. It confirms or kills the save-prompt theory in one run, and the thesis does not propose it.

Counter-evidence:

- [k30](../../scripts/test/run-integration.mjs): "// The child leads its own process group, so this reaches the VS Code host and its helpers."
- [k31](../../scripts/test/run-integration.mjs): "killGroup(child, "SIGKILL");"

### 13. Upstream patterns worth copying: a separate logs and crashes directory for each suite; tracing turned on automatically when GITHUB_WORKSPACE is set; an afterEach that keeps the trace and takes a screenshot only for failed tests; and a log line when a kill is forced. Upstream drives Electron through Playwright, while this repo drives CDP by hand, so copy the hook structure rather than Playwright tracing

Verdict: middle. Confidence: high.

I read main.ts:425-430, utils.ts:122-140, playwrightDriver.ts:549-569 and code.ts:208.

Citations:

- [r13a](https://raw.githubusercontent.com/microsoft/vscode/main/test/smoke/src/main.ts): "tracing: opts.tracing || !!process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || !!process.env.GITHUB_WORKSPACE,"
- [r13b](https://raw.githubusercontent.com/microsoft/vscode/main/test/smoke/src/main.ts): "logsPath: path.join(logsRootPath, 'suite_unknown'),"
- [r13c](https://raw.githubusercontent.com/microsoft/vscode/main/test/automation/src/playwrightDriver.ts): "To ensure we have a screenshot at the end where"
- [r13d](https://raw.githubusercontent.com/microsoft/vscode/main/test/automation/src/code.ts): "call did not terminate the process yet, but safeToKill is true, so we can kill it"

Thesis (high): VS Code's own smoke harness keeps a per-suite logs directory and a crashes directory, enables tracing when running in CI, and logs an escalation when a process does not exit. These are patterns this repo can copy: per-suite log directories, tracing on in CI, and a logged forced kill.

Thesis citations:

- [c26](https://raw.githubusercontent.com/microsoft/vscode/main/test/smoke/src/main.ts): "logsPath: path.join(logsRootPath, 'suite_unknown'),"
- [c27](https://raw.githubusercontent.com/microsoft/vscode/main/test/smoke/src/main.ts): "tracing: opts.tracing || !!process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || !!process.env.GITHUB_WORKSPACE,"
- [c28](https://raw.githubusercontent.com/microsoft/vscode/main/test/automation/src/code.ts): "call did not terminate the process yet, but safeToKill is true, so we can kill it"

Antithesis: The thesis cites three upstream facts (logs directory, tracing in CI, a forced-kill log line) but misses the central pattern. The upstream smoke suite has a per-test `afterEach` that logs '!!! FAILURE !!!' and calls `stopTracing(testTitle, failed)`, persisting the trace only for failed tests.

Antithesis: It also misses `dumpFailureDiagnostics`, which lists persisted traces and screenshots, tails the window logs and copies runtime logs on failure.

Antithesis: Upstream runs Playwright over Electron. This repo drives CDP by hand, so the right transplant is the hook shape (per-test, failure-only, written to a stable directory), not Playwright tracing itself.

Counter-evidence:

- [k32](https://raw.githubusercontent.com/microsoft/vscode/main/test/smoke/src/utils.ts): "Best-effort failure diagnostics for the Copilot smoke tests."
- [k33](https://raw.githubusercontent.com/microsoft/vscode/main/test/automation/src/playwrightDriver.ts): "To ensure we have a screenshot at the end where"

### 14. @vscode/test-electron calls killTree only from its second-Ctrl+C handler. On a normal exit it simply resolves or rejects, and nothing in it kills a host that never exits. The thesis missed the useful option: runTests accepts stdout and stderr writable streams. Teeing those to a timestamped file is the cheapest durable record of host output

Verdict: antithesis. Confidence: high.

In the installed runTest.js, killTree is called inside ctrlc2 (lines 97-103). runTest.d.ts documents the stdout stream option.

Citations:

- [r14a](../../node_modules/@vscode/test-electron/out/runTest.js): "console.log('Closing VS Code forcefully.');"
- [r14b](../../node_modules/@vscode/test-electron/out/runTest.js): "(0, util_1.killTree)(cmd.pid, true);"
- [r14c](../../node_modules/@vscode/test-electron/out/runTest.d.ts): "Writable stream where stdout from the child process will be forwarded."

Thesis (medium): @vscode/test-electron passes --disable-workspace-trust to every VS Code launch and kills the whole process tree when the child exits. This is the place to look when a window or helper process outlives its tests, since the runner's own teardown is the only kill path.

Thesis citations:

- [c29](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/runTest.ts): "'--disable-workspace-trust',"
- [c30](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/runTest.ts): "killTree(cmd.pid!, true);"

Antithesis: Misreads test-electron. The thesis says it 'kills the whole process tree when the child exits'. In the installed 3.1.0 the `killTree` call runs only on a second Ctrl+C ('Closing VS Code forcefully.'). Normal exit just resolves or rejects on the child's `close` or `exit` event. Nothing in it kills a host that never exits.

Antithesis: It also says the runner's own teardown is 'the only kill path'. In the smoke path the launcher's watchdog `process.exit(124)` is another, and in the integration path `run-integration.mjs` kills the group on child exit.

Antithesis: The cited flag `--disable-workspace-trust` is hard-coded and irrelevant to the hang. The thesis does not connect it to a 'trusted' label or to an exit.

Antithesis: Missed option: `runTests` takes `stdout` and `stderr` writable streams. Teeing them to a file, with timestamps, is the cheapest durable host-output capture.

Antithesis: `killTree(cmd.pid!, true);` exists in `runTest.ts`, but it is inside the second-Ctrl+C handler, not on child exit.

Counter-evidence:

- [k34](../../node_modules/@vscode/test-electron/out/runTest.js): "console.log('Closing VS Code forcefully.');"
- [k35](../../node_modules/@vscode/test-electron/out/runTest.js): "(0, util_1.killTree)(cmd.pid, true);"
- [k36](https://raw.githubusercontent.com/microsoft/vscode-test/main/lib/runTest.ts): "Writable stream where stdout from the child process will be forwarded."

### 15. test-cli's config accepts one or more Mocha reporters, and .vscode-test.mjs sets only ui, timeout and color. Adding a file reporter (JSON or JUnit alongside spec) to the integration labels is therefore a config-only change. The smoke runner builds its own `new Mocha(...)`, so it needs a reporter option or a fail listener added in runTests.ts

Verdict: antithesis. Confidence: high.

config.d.cts:158 and .vscode-test.mjs:58.

Citations:

- [r15a](../../node_modules/@vscode/test-cli/out/config.d.cts): "One or more reporters to use, either an array or an object of options."
- [r15b](../../.vscode-test.mjs): "mocha: { ui: "tdd", timeout: 30_000, color: true },"

Thesis (medium): @vscode/test-cli runs its suites with Mocha, so Mocha's per-test error and stack are the record to keep. Those records must be written to a file in CI, because the bundle cannot be rebuilt from the console alone.

Thesis citations:

- [c31](https://code.visualstudio.com/api/working-with-extensions/testing-extension): "The CLI exclusively uses Mocha under the hood."

Antithesis: 'The CLI exclusively uses Mocha' is true but empty advice. The useful fact is that test-cli's config accepts `reporter` (one or more, array or options object), and the repo's `.vscode-test.mjs` sets only `ui`, `timeout` and `color`. So a file reporter is a config change for the integration labels. The smoke runner builds `new Mocha(...)` itself and needs a `runner.on('fail')` listener or a reporter option.

Counter-evidence:

- [k37](../../node_modules/@vscode/test-cli/out/config.d.cts): "One or more reporters to use, either an array or an object of options."
- [k38](../../.vscode-test.mjs): "mocha: { ui: "tdd", timeout: 30_000, color: true },"

### 16. Each failing test should produce one bundle at `<out>/<host>/<fixture>/failures/<test-slug>/` containing: error.json (title, which wait failed, its predicate, error, stack); probe.jsonl (one line per poll with wall time, the iframe target list with id/url/title, the frame evaluated, any swallowed error, timeOrigin and the returned state); a CDP screenshot; the webview's console messages and exceptions; the host's dirty documents; and pointers into the --logsPath directory (main, renderer, exthost and the extension's output channel). The per-step directory also holds host.log (teed stdout/stderr) and, on a hang, watchdog.txt (ps, /proc or sample output, `code --status`)

Verdict: middle. Confidence: medium.

Each item answers a question the four failures left open: which wait failed, which frame was read, whether the page was rebuilt, and why a host did not exit. The layout is a proposal and has not been built.

Citations:

- r16a (cdpClient.ts, before the split): "return Date.now() - started;"

Thesis (medium): A failure bundle per failing test should hold: a failure screenshot, the probe trace with frame id, targetId and timeOrigin per poll, the webview console, the extension host and renderer logs copied before cleanup, the Mocha error and stack, and a process list. Together these let a failure be read without a rerun.

Thesis citations:

- [c17](../../src/test/smoke/panelSmoke.test.ts): "const png = await captureWorkbenchScreenshot(cdpPort, host);"
- [c18](../../scripts/smoke/run-smoke.mjs): "rmSync(userDataDir, { recursive: true, force: true });"

Antithesis: The bundle list is generic and omits the items that would settle these particular failures: which wait and which predicate failed; the last N polls with the iframe target list (id, url, title) and execution-context events; the dirty-document list; the window `--status` dump; and the host's main-process log.

Antithesis: It cites a success-checkpoint screenshot call and the cleanup `rmSync` as support for a failure bundle. Neither shows that a failure artifact exists.

### 17. Ranked plan, cheapest high-value changes first. (1) Give every waitFor* call a label that appears in its error, and add a `reason` and a poll log to waitForPanelGone and evaluatePanel (panelViewState.test.ts, cdpClient.ts). (2) Pass --logsPath, --crash-reporter-directory and --log <publisher.name>:trace, pointing to a per-step directory outside userData (run-smoke.mjs; .vscode-test.mjs launchArgs for integration). (3) Add a fail hook in runTests.ts that writes error.json and a CDP screenshot, and add a JSON file reporter in .vscode-test.mjs. (4) Tee runTests' stdout/stderr to host.log with timestamps. In docker-smoke.sh, keep each host's log under $out and print from the 'N failing' line instead of tail -60. (5) In ci.yml, add one `if: failure()` actions/upload-artifact step per smoke job for the per-step directories, with short retention. Add a $GITHUB_STEP_SUMMARY listing each failing test's title, the wait that failed, its last state and a link to the screenshot. (6) Add an integration watchdog to run-integration.mjs that captures `code --status`, /proc or sample output and a CDP screenshot, then SIGKILLs the group, plus the dirty-documents `after` hook. (7) Add an out-of-process CDP flight recorder to run-smoke.mjs (see 18). (8) Add host-side instrumentation for docs drafts and view visibility (see 19). Drop the step that installs gdb

Verdict: middle. Confidence: medium.

Steps 1 and 2 cost a few lines each and would have identified both webview failures directly. Steps 5 and 6 need CI wiring. Step 7 is the largest. I did not check the upload size cap and retention against GitHub's current limits; they are policy choices.

Citations:

- [r17a](../../scripts/smoke/run-smoke.mjs): "`--remote-debugging-port=${cdpPort}`,"
- [r17b](../../scripts/smoke/docker-smoke.sh): "cat "$work"/*.log | grep -E 'FPU_HOST_METADATA|FPU_SMOKE_SUITES_SELECTED|FPU_SMOKE_EXTHOST_START_MS|passing|failing' || true"
- [r17c](../../scripts/test/run-integration.mjs): "killGroup(child, "SIGKILL");"

Thesis (medium): Ranked plan. (1) Make evaluatePanel record each frame's error and matched target, and make waitForPanelGone return a reason with its time (src/test/smoke/cdpClient.ts). (2) Write a failure bundle (screenshot, probe trace, copied logs, process list, Mocha stack) before cleanup (src/test/smoke/runTests.ts, scripts/smoke/run-smoke.mjs). (3) Turn on trace logging in CI smoke runs and keep userData logs on failure (scripts/smoke/run-smoke.mjs, .github/workflows/ci.yml). (4) Add an if: failure() upload-artifact step for the bundle with a size cap and a PR summary (.github/workflows/ci.yml). (5) Add a watchdog to the integration runner that dumps the process tree and samples the stack before killing (scripts/test/run-integration.mjs). (6) Add procps and gdb to the Docker images (docker/integration/Dockerfile, docker/smoke/Dockerfile). Retries and timeouts are excluded.

Thesis citations:

- c1 (cdpClient.ts, before the split): "for (const frame of await panelFrames(port)) {"
- [c25](../../scripts/test/run-integration.mjs): "child.on("exit", (exitCode) => {"
- [c24](../../.github/workflows/ci.yml): "runs-on: macos-latest timeout-minutes: 45"

Antithesis: The ranking buries the cheapest and most informative changes. The plan puts the probe and bundle work first and trace-level logs third. Given the evidence, the cheapest and most informative steps are: (1) label every `waitFor*` call so the error names the wait and predicate; (2) pass `--logsPath` and `--crash-reporter-directory` outside the cleaned directories; (3) set `FPU_SMOKE_SCREENSHOTS` in CI and add an `if: failure()` upload; (4) tee host stdout and stderr with timestamps via `runTests`' stream options.

Antithesis: Item 6 (add procps and gdb to Docker) is mostly moot: `ps` is already in the image, and gdb on Electron is a poor return. Replace it with a /proc and `code --status` dump.

Antithesis: Nothing in the plan targets the Cursor docs failure's likely cause, state leaking between the documentation-editor suites. A before-each probe that fails fast with 'docs editor already dirty: <state>' would turn that into a named defect.

Counter-evidence:

- [k39](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/environment/node/argv.ts): "Print process usage and diagnostics information."

### 18. Every CDP event a webview lifecycle recorder needs is defined in the protocol: Target.targetCreated, targetDestroyed and targetCrashed; Runtime.executionContextCreated and executionContextDestroyed; Runtime.exceptionThrown; Runtime.consoleAPICalled; and Page.frameNavigated. The recorder belongs in the launcher (run-smoke.mjs), connected at the browser level with Target.setDiscoverTargets, so it outlives a blocked extension host. It should write timestamped JSONL that both the fail hook and the watchdog flush

Verdict: antithesis. Confidence: high.

I downloaded browser_protocol.json and js_protocol.json and grepped the event descriptions. Putting the recorder in the launcher is a design choice: the tests run inside the extension host (runTests.ts), while the watchdog already runs in the launcher.

Citations:

- [r18a](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json): "Issued when a target is destroyed."
- [r18b](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json): "Issued when a target has crashed."
- [r18c](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/js_protocol.json): "Issued when execution context is destroyed."
- [r18d](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/js_protocol.json): "Issued when exception was thrown and unhandled."
- [r18e](../../scripts/smoke/run-smoke.mjs): "FPU_SMOKE_WATCHDOG: ${host} did not finish within ${HOST_WATCHDOG_MS} ms"

Thesis (speculative): Recording the CDP target lifecycle (attach, detach, destroy, crash) and the console and log entries for each webview would show the exact sequence of events in each hide and show. The specific CDP event names are not verified against the protocol docs in this answer, so treat the event list as a design choice to confirm.

Antithesis: The CDP event list is left as speculative, but it can be verified. The protocol JSON defines the events a webview lifecycle recorder needs, including `Target.targetCrashed`, `Runtime.executionContextDestroyed` and `Runtime.exceptionThrown`. `Target.targetDestroyed`, `Page.frameNavigated`, `Runtime.consoleAPICalled` and `Log.entryAdded` are defined there as well.

Antithesis: The thesis misses where the recorder should live. The smoke tests, and `cdpClient.ts` with them, run inside the extension host. A recorder there dies with the host and cannot see a host hang. It belongs in the launcher (`run-smoke.mjs`), which already owns the watchdog and the CDP port. It would subscribe at the browser endpoint with `Target.setDiscoverTargets` and write a timestamped JSONL timeline the watchdog can flush.

Counter-evidence:

- [k40](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json): "Issued when a target has crashed."
- [k41](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/js_protocol.json): "Issued when execution context is destroyed."
- [k42](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/js_protocol.json): "Issued when exception was thrown and unhandled."

### 19. The most likely source of the dirty Cursor docs page is the host's in-memory drafts, not webview state. The docs host keeps unsaved drafts in memory and sends the stored draft with every renderDocumentation. The page clears the host's copy with a fire-and-forget saveDraft once it is no longer dirty. The earlier suite, documentationEditorInteractions, types ' smoke draft' and then waits only for the page to report clean; it never checks that the host's map is empty. If that clearing message is lost or arrives late, the next docs page receives ' smoke draft' and opens dirty, which is exactly the failing state. The suite's own comment already notes that a dirty editor can leak between suites. The cheap diagnostic: log each host saveDraft and transmitData with a timestamp and the draft keys, and check at the end of each suite that the host holds no drafts

Verdict: new. Confidence: low.

The code path is confirmed in docsEditPanel.ts and useDraftSync.ts. That the clearing message was actually lost is not shown. Other routes, such as another suite editing the same model, are not ruled out. documentationEditorInteractions runs before panelViewState because runTests sorts the files.

Citations:

- [r19a](../../src/features/docs/docsEditPanel.ts): "Unsaved drafts by model file path; host memory only, never webview state."
- [r19b](../../src/features/docs/docsEditPanel.ts): "draft: this.documentation"
- [r19c](../../webview_panels/src/modules/documentationEditor/state/useDraftSync.ts): "executeRequestInAsync("saveDraft", { model: held });"
- [r19d](../../src/test/smoke/documentationEditorInteractions.test.ts): "alone can match before the editor has settled, and a dirty editor leaks into the next suite."
- [r19e](../../src/test/smoke/documentationEditorInteractions.test.ts): "const edit = `${original} smoke draft`;"

### 20. In vscode-376 the final query page was probably the one created at the start of the test. Its timeOrigin, 1792471285620.4, is about 04:41:25.6 UTC, and the next test's docs page loaded about 32 s later, which is roughly one full 120 × 250 ms wait. If so, the page was not rebuilt even though waitForPanelGone returned. It then showed 'Preview' instead of the 'SQL' it had held, which fits the host sending its last result again to a page that survived. That points either to a false 'gone' (point 1) or to a release() that returned without clearing (point 2), followed by a tab reset when the result was replayed. The probe log in plan step 1 would settle it

Verdict: new. Confidence: low.

This rests on epoch arithmetic over values from the log, which can't be cited, and on the 120 × 250 ms wait loop in the source. The failing run never logged `selected`, so I can't confirm the final page is the one from before the hide.

Citations:

- [r20a](../../src/test/smoke/panelViewState.test.ts): "for (let attempt = 0; attempt < 120; attempt += 1) {"
- [r20b](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/webview/browser/overlayWebview.ts): "if (this._owner !== owner) {"

### 21. For VS Code runs in CI, the log's timestamps can't be used to build a timeline. In vscode-376, every Mocha line from 'reports host runtime versions' to the failure summary has the same timestamp, 04:42:00.8, so the host's output reached the runner in one batch at the end. Cursor's log is timestamped as it runs. Timestamps therefore have to be taken inside the process: Date.now() in the probe log, the fail hook and the teed host.log. CI timestamps can't be trusted to order events

Verdict: new. Confidence: low.

Seen in vscode-376 lines 448-552, which can't be cited. I have not found what causes the buffering, whether the VS Code host or the way test-electron forwards output.

Citations:

- [r21a](../../node_modules/@vscode/test-electron/out/runTest.d.ts): "Writable stream where stdout from the child process will be forwarded."

## Alternatives the thesis missed

The Cursor docs-draft failure is most likely not a hide/show defect. In the Cursor log the failing frame is panelViewState.test.js:183:24, which in the compiled test is the first wait, `loaded`. That wait requires `!modified`. The page opened already dirty with ' smoke draft', the text that documentationEditorInteractions.test.ts types earlier in the same host. The probable cause is state leaking from one suite into the next (persisted webview state or host draft), and the `modified` flag is a fragile text sniff. The first fix is to log which wait failed and the docs state at entry. Do not touch the hide/show path until that is known. Confidence is medium. The log itself is uncitable here, so the frame number is uncited, but the compiled code and sources are cited.

- [m1](../../src/test/smoke/panelViewState.test.ts): "const loaded = await waitForDocs(port, (docs) => docs.description !== null && !docs.modified);"
- [m2](../../src/test/smoke/panelViewState.test.ts): "(docs) => docs.description !== null && !docs.modified,"
- [m3](../../src/test/smoke/documentationEditorInteractions.test.ts): "const edit = `${original} smoke draft`;"
- [m4](../../src/test/smoke/webviewInteractions.ts): "modified: document.body.innerText.includes("modified"),"

The vscode query-tab failure may be a real product or host race rather than a probe fault. VS Code clears a non-retained webview only when the releasing view still owns it, so a lost ownership race leaves the old page alive with its old timeOrigin. Separately, a final state of 'active: Preview…' is what a rebuilt page that failed to restore the SQL tab would show. Both are testable if the harness records the iframe target list, extension-side `onDidChangeVisibility` / `onDidChangeViewState` timestamps, and each poll's timeOrigin. Confidence is low to medium. The failing run's `selected` state is not logged, so the two cannot be told apart from existing artifacts.

- [m5](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/webview/browser/overlayWebview.ts): "if (this._owner !== owner) {"
- [m6](../../src/test/smoke/panelViewState.test.ts): "throw new Error(`query results tabs never matched: ${JSON.stringify(last)}`);"

Add an out-of-process flight recorder in the launcher (run-smoke.mjs), not in the extension host. It would hold a browser-level CDP connection (target created, destroyed and crashed events), per-page console and exception events, and a ring buffer flushed on a failure or on the watchdog firing. The in-host client dies with the host, and the watchdog already lives in the launcher. The protocol defines the events needed.

- [m7](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json): "Issued when a target has crashed."
- [m8](../../scripts/smoke/run-smoke.mjs): "FPU_SMOKE_WATCHDOG: ${host} did not finish within ${HOST_WATCHDOG_MS} ms"

Upstream's cheapest wins, which the thesis only half-lists: pass `--logsPath` and `--crash-reporter-directory` to a directory outside the cleaned ones, and add `--log` with the per-extension form for this extension's id. Use a per-test `afterEach` that writes failure artifacts only for failed tests. VS Code's own suite does this with `stopTracing(..., failed)` plus a screenshot at failure.

- [m9](https://raw.githubusercontent.com/microsoft/vscode/main/test/automation/src/electron.ts): "`--logsPath=${logsPath}`"
- [m10](https://raw.githubusercontent.com/microsoft/vscode/main/test/smoke/src/utils.ts): `await app?.stopTracing(testTitle.replace(/[^a-z0-9\-]/ig, '_'), failed);`
- [m11](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/environment/node/argv.ts): "You can also configure the log level of an extension by passing extension id and log level in the following format: '${publisher}.${name}:${logLevel}'."

For the integration 'trusted' hang, install a hang watchdog in `run-integration.mjs`. On a timeout it would run `code --status --user-data-dir=<dir>` against the live instance (process tree and window state), then read /proc/<pid>/{status,wchan,stack} on Linux or run `sample` on macOS, take a CDP `Page.captureScreenshot` if `--remote-debugging-port` is on, then SIGKILL the group. Add a root-level `after` hook in the integration suites that logs dirty documents and tabs, to confirm or rule out the save-prompt theory. Today the runner awaits the child's `exit` and has no timer.

- [m12](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/environment/node/argv.ts): "Print process usage and diagnostics information."
- [m13](../../scripts/test/run-integration.mjs): "killGroup(child, "SIGKILL");"

Make Docker smoke output survive. Keep each host's full log in `$out/<host>/host.log` (the directory that is already copied out) instead of a `$work` directory that is deleted on success. On success the script greps only a few marker lines out of the logs before deleting them. Print the failing host's Mocha summary and error (everything from the 'N failing' line), not a fixed `tail -60`. Set `FPU_SMOKE_SCREENSHOTS` in CI so the existing PNG and JSON checkpoint package is produced there too, with failure-only upload.

- [m14](../../scripts/smoke/docker-smoke.sh): "tail -60 "$work/${hosts[$i]}.log" >&2"
- [m15](../../scripts/smoke/docker-smoke.sh): "cat "$work"/*.log | grep -E 'FPU_HOST_METADATA|FPU_SMOKE_SUITES_SELECTED|FPU_SMOKE_EXTHOST_START_MS|passing|failing' || true"
- [m16](../../justfile): "FPU_SMOKE_SCREENSHOTS="{{ out }}" just smoke {{ args }}"

## Open questions

- In vscode-376, was the final page (timeOrigin 1792471285620.4) the same page as `selected`? The per-poll trace from step 1 would show whether waitForPanelGone returned because no iframe target was listed, because evaluation threw, or because the page really was gone.
- Does OverlayWebview.release() ever return early on the ownership check when this repo hides a WebviewView? Extension-side onDidChangeVisibility timestamps lined up with Target.targetDestroyed events would show it.
- In the Cursor run, did the docs host still hold a ' smoke draft' entry after documentationEditorInteractions finished, and did the host receive the page's clearing saveDraft? A host draft log and a check at the end of each suite would answer both.
- Why did the vscode host's Mocha output reach the CI log in one batch at 04:42:00.8 while Cursor's arrived as it ran? Is the buffering in VS Code's handling of extension host stdout or in how test-electron forwards it?
- What is the 'trusted' integration host waiting on at shutdown: a modal save prompt, a helper process that won't exit, or an extension deactivate that never returns? `code --status` plus the dirty-documents hook from one hung run would tell.
- How large is the artifact for one step (trace-level logs plus PNGs) on macOS CI, and what retention and size cap keep one failure-only upload per job cheap?

## Rejected citations

None.
