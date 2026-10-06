import { existsSync } from "fs";
import { dirname, join } from "path";
import { extensions, version } from "vscode";
import type { RegisterCommand } from "../../commandRegistry";
import { DBT_PROJECT_FILE, readDbtProjectFile } from "../../core/project";
import { CATALOG_FILE, MANIFEST_FILE } from "../../dbt_integration/domain";
import type { Project } from "../../projects/project";
import type { Projects } from "../../projects/projects";
import { getFirstWorkspacePath } from "../../projects/workspacePath";
import { inspectSettings, readEnvironment } from "../../settings";
import type { DiagnosticsOutputChannel } from "./diagnosticsOutputChannel";

type Output = DiagnosticsOutputChannel;

const SENSITIVE =
  "* Please remove any sensitive information before sending it to us";

function printEnvironment(out: Output) {
  out.logBlockWithHeader(
    ["Printing extension host environment variables...", SENSITIVE],
    Object.entries(readEnvironment()).map(([key, value]) => `${key}=${value}`),
  );
  out.logNewLine();
  out.logBlockWithHeader(
    ["Printing extension settings...", SENSITIVE],
    inspectSettings().map(({ key, value, overriddenIn }) => {
      const overriddenText = overriddenIn
        ? `${key} is overridden in ${overriddenIn} settings`
        : "";
      const valueText =
        typeof value === "string" ? value : JSON.stringify(value);
      return `${key}=${valueText}\t\t${overriddenText}`;
    }),
  );
  out.logNewLine();
  out.logBlock([
    `VSCode version=${version}`,
    `Extension version=${
      extensions.getExtension("innoverio.vscode-dbt-power-user")?.packageJSON
        ?.version
    }`,
    "DBT integration mode=fusion",
    `First workspace path=${getFirstWorkspacePath()}`,
  ]);
  out.logNewLine();
}

function projectPaths(project: Project) {
  const targetPath = project.getTargetPath();
  return [
    { pathType: "DBT Project File", path: project.getDBTProjectFilePath() },
    { pathType: "Target", path: targetPath },
    { pathType: "PackageInstall", path: project.getPackageInstallPath() },
    {
      pathType: "Manifest",
      path: targetPath ? join(targetPath, MANIFEST_FILE) : undefined,
    },
    {
      pathType: "Catalog",
      path: targetPath ? join(targetPath, CATALOG_FILE) : undefined,
    },
    ...(project.getModelPaths() || []).map((path) => ({
      pathType: "Model",
      path,
    })),
    ...(project.getSeedPaths() || []).map((path) => ({
      pathType: "Seed",
      path,
    })),
    ...(project.getMacroPaths() || []).map((path) => ({
      pathType: "Macro",
      path,
    })),
  ];
}

async function printProjectInfo(out: Output, project: Project) {
  out.logLine(`Project Name=${project.getProjectName()}`);
  out.logLine(`Adapter Type=${project.getAdapterType()}`);
  const fusionVersion = project.getFusionVersion();
  out.logLine(
    fusionVersion
      ? `Fusion version=${fusionVersion.raw.trim()}`
      : "Fusion is not initialized properly",
  );
  out.logNewLine();
  for (const { pathType, path } of projectPaths(project)) {
    if (!path) {
      out.logLine(`${pathType} path not found`);
      continue;
    }
    const exists = existsSync(path)
      ? "File exists at location"
      : "File doesn't exists at location";
    out.logLine(`${pathType} path=${path}\t\t${exists}`);
  }
  const projectFile = readDbtProjectFile(
    dirname(project.getDBTProjectFilePath()),
  );
  if (projectFile.kind === "unreadable") {
    throw new Error(projectFile.message);
  }
  if (projectFile.kind !== "missing") {
    out.logNewLine();
    out.logNewLine();
    out.logLine(DBT_PROJECT_FILE);
    out.logHorizontalRule();
    out.logLine(projectFile.text.replace(/\n/g, "\r\n"));
    out.logHorizontalRule();
  }
  out.logNewLine();
  const diagnostics = project.getAllDiagnostic();
  out.logLine(`Number of diagnostics issues=${diagnostics.length}`);
  for (const d of diagnostics) {
    out.logLine(d.message);
  }
  await project.debug();
}

async function printProjects(out: Output, projects: readonly Project[]) {
  for (const project of projects) {
    try {
      out.logHorizontalRule();
      out.logLine(`Printing information for ${project.getProjectName()}`);
      out.logHorizontalRule();
      await printProjectInfo(out, project);
    } catch (e) {
      out.logNewLine();
      out.logLine("Failed to print all the info for the project...");
      out.logLine(`Error=${e}`);
    } finally {
      out.logHorizontalRule();
    }
  }
}

async function runDiagnostics(out: Output, projects: Projects) {
  try {
    out.show();
    out.logLine("Diagnostics started...");
    out.logNewLine();
    printEnvironment(out);
    const all = projects.all();
    out.logLine(`Number of projects=${all.length}`);
    if (all.length === 0) {
      out.logLine("No project detected");
      out.logLine("Can't proceed further without project");
      return;
    }
    out.logNewLine();
    await printProjects(out, all);
    out.logNewLine();
    out.logLine("Diagnostics completed successfully...");
  } catch (e) {
    out.logNewLine();
    out.logLine("Diagnostics ended with error...");
    out.logLine(`Error=${e}`);
  }
}

export function registerDiagnosticsCommands(
  projects: Projects,
  out: DiagnosticsOutputChannel,
  register: RegisterCommand,
) {
  return [
    register("fusionPowerUser.diagnostics", () =>
      runDiagnostics(out, projects),
    ),
  ];
}
