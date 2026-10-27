/**
 * Wall-clock bounds, in milliseconds, for work that can wait on a process, the OS or a webview. Each entry says why
 * the bound exists; a bound without a reason here does not belong in the extension. Request bounds for the Fusion
 * server live in `src/core/lsp/requestPolicy.ts`, and no other module declares a timing bound.
 */
export const BOUNDS = {
  /** A Fusion server may ignore SIGTERM. After this long the process gets SIGKILL; exit ends the wait early. */
  disposalGraceMs: 5_000,
  /** A Fusion server may stay alive and never connect. Exit is handled separately, so this covers only that case. */
  connectionTimeoutMs: 30_000,
  /** Delay before the first restart after a crash-loop exit; doubles with each further unexpected exit. */
  backoffBaseMs: 500,
  /** Ceiling on the crash-loop restart delay. */
  backoffCapMs: 8_000,
  /** An external binary may hang on `--version`. Silence for this long is reported as not responding. */
  versionProbeTimeoutMs: 15_000,
  /** An external binary may hang, for example on a mise or direnv prompt, while the tool environment is read. */
  toolEnvTimeoutMs: 5_000,
  /** Registry changes within this window reconcile once, so a burst of folder changes starts no extra client. */
  reconcileQuietMs: 500,
  /** No file event marks the end of a burst, so the rebuild waits for this much quiet after the last one. */
  fileEventQuietMs: 500,
  /** A webview may never post ready. After this long the caller gets false and treats the page as not loaded. */
  pageReadyMs: 10_000,
} as const;
