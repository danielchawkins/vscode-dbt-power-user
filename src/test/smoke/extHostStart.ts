/**
 * Milliseconds from the launcher's runTests call to the extension host's first test-runner callback.
 * The launcher passes its own Date.now() reading as FPU_SMOKE_LAUNCH_EPOCH_MS; a missing or malformed value gives
 * undefined, so an unlaunched run prints nothing rather than a bogus number.
 */
export function extHostStartMs(
  launchEpochMs: string | undefined,
  nowMs: number,
): number | undefined {
  if (launchEpochMs === undefined || launchEpochMs.trim() === "") {
    return undefined;
  }
  const launch = Number(launchEpochMs);
  if (!Number.isFinite(launch) || launch <= 0 || nowMs < launch) {
    return undefined;
  }
  return Math.round(nowMs - launch);
}
