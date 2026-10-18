export type FusionVersion = {
  major: number;
  minor: number;
  patch: number;
  raw: string;
};

export const MINIMUM_FUSION = { major: 2, minor: 0, patch: 6 };

/** Where the probed binary came from: the `dbtPath` setting, a tool manager's PATH, or the host PATH. */
export type FusionExecutableSource = "configured" | "mise" | "direnv" | "path";

/** Version judgement of `dbt --version` output, before the probed binary is attached. */
export type FusionVersionJudgement =
  | { kind: "ok"; version: FusionVersion }
  | { kind: "untestedMajor"; version: FusionVersion }
  | { kind: "tooOld"; version: FusionVersion }
  | { kind: "notFusion"; raw: string };

/** The absolute path probed and where it came from. */
type FusionProbedBinary = {
  path: string;
  source: FusionExecutableSource;
};

export type FusionVersionVerdict =
  | { kind: "ok"; version: FusionVersion }
  | { kind: "untestedMajor"; version: FusionVersion }
  | ({ kind: "tooOld"; version: FusionVersion } & FusionProbedBinary)
  | ({ kind: "notFusion"; raw: string } & FusionProbedBinary)
  | { kind: "notFound"; path: string; source: FusionExecutableSource };

/**
 * The version in `dbt --version` output: `dbt X.Y.Z`, optionally with a prerelease or build suffix
 * (`dbt 2.0.6-preview.3 (a1b2c3d …)`), or the legacy `dbt-fusion X.Y.Z`. A suffix does not change the comparison, so
 * an old preview build reports as too old rather than as not Fusion.
 */
export function parseFusionVersion(stdout: string): FusionVersion | undefined {
  const match =
    /^dbt(?:-fusion)?\s+v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?(?:\s|$)/m.exec(
      stdout,
    );
  if (!match) {
    return;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: stdout,
  };
}

export function judgeFusionVersion(
  version: FusionVersion | undefined,
  raw: string,
): FusionVersionJudgement {
  if (!version) {
    return { kind: "notFusion", raw };
  }
  if (version.major > MINIMUM_FUSION.major) {
    return { kind: "untestedMajor", version };
  }
  if (
    version.major < MINIMUM_FUSION.major ||
    version.minor < MINIMUM_FUSION.minor ||
    (version.minor === MINIMUM_FUSION.minor &&
      version.patch < MINIMUM_FUSION.patch)
  ) {
    return { kind: "tooOld", version };
  }
  return { kind: "ok", version };
}
