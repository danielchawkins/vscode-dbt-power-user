export const OPT_IN_SUITES = [
  "lineageInteractions",
  "lineageGrouping",
  "queryResultsInteractions",
  "documentationEditorInteractions",
  "toolEnvironment",
] as const;

const optIn: readonly string[] = OPT_IN_SUITES;

export function selectSuites(
  all: readonly string[],
  requested: string | undefined,
): string[] {
  const defaults = all.filter((name) => !optIn.includes(name));
  const names = (requested ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  if (names.length === 0) {
    return [...new Set(defaults)].sort();
  }
  const selected = new Set<string>();
  for (const name of names) {
    if (name === "default") {
      defaults.forEach((d) => selected.add(d));
    } else if (all.includes(name)) {
      selected.add(name);
    } else {
      throw new Error(`Unknown smoke suite: ${name}`);
    }
  }
  return [...selected].sort();
}
