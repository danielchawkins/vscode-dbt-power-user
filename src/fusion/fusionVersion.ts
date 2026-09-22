export type FusionVersion = {
  major: number;
  minor: number;
  patch: number;
  raw: string;
};

export const MINIMUM_FUSION = { major: 2, minor: 0, patch: 5 };

export type FusionVersionVerdict =
  | { kind: "ok"; version: FusionVersion }
  | { kind: "untestedMajor"; version: FusionVersion }
  | { kind: "tooOld"; version: FusionVersion }
  | { kind: "notFusion"; raw: string }
  | { kind: "notFound"; path: string; source: "configured" | "path" };

export function parseFusionVersion(stdout: string): FusionVersion | undefined {
  const match = /^dbt\s+(\d+)\.(\d+)\.(\d+)(?:\s|$)/m.exec(stdout);
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
): FusionVersionVerdict {
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
