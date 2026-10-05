import { Uri, window, workspace } from "vscode";
import { parseDocument } from "yaml";
import {
  TestMetadataAcceptedValues,
  TestMetadataRelationships,
} from "./dbt_integration";
import { readSetting } from "./settings";

export function stripANSI(src: string): string {
  return src.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    "",
  );
}

export function getFirstWorkspacePath(): string {
  // CLI commands run from a workspace folder when one is open; otherwise fall
  // back to the extension host working directory.
  const folders = workspace.workspaceFolders;
  if (folders) {
    return folders[0].uri.fsPath;
  } else {
    // TODO: this shouldn't happen but we should make sure this is valid fallback
    return Uri.file("./").fsPath;
  }
}

export const getColumnNameByCase = (columnName: string, adapter: string) => {
  if (isQuotedIdentifier(columnName, adapter)) {
    return columnName;
  }
  return columnName.toLowerCase();
};

export const isColumnNameEqual = (
  columnNameFromYml: string | undefined,
  incomingColumnName: string | undefined,
) => {
  if (!columnNameFromYml || !incomingColumnName) {
    return false;
  }

  if (columnNameFromYml === incomingColumnName) {
    return true;
  }

  return columnNameFromYml.toLowerCase() === incomingColumnName.toLowerCase();
};

export const isQuotedIdentifier = (columnName: string, adapter: string) => {
  const regexFromConfig = readSetting("unquotedCaseInsensitiveIdentifierRegex");
  if (regexFromConfig) {
    return !new RegExp(regexFromConfig).test(columnName);
  }

  const specialCases = ["trino", "athena", "postgres", "duckdb", "risingwave"];
  if (specialCases.includes(adapter)) {
    return !/^([_a-z]+[_a-z0-9$]*)$/.test(columnName);
  }

  // snowflake and most of the db follow standard sql spec of making the column names to uppercase by default
  return !/^([_A-Z]+[_A-Z0-9$]*)$/.test(columnName);
};

export const isRelationship = (
  metadata:
    | TestMetadataRelationships
    | TestMetadataAcceptedValues
    | { [x: string]: unknown },
): metadata is TestMetadataRelationships => {
  return (
    (metadata as TestMetadataRelationships).field !== undefined &&
    (metadata as TestMetadataRelationships).to !== undefined
  );
};

export const isAcceptedValues = (
  metadata:
    | TestMetadataRelationships
    | TestMetadataAcceptedValues
    | { [x: string]: unknown },
): metadata is TestMetadataAcceptedValues => {
  return (metadata as TestMetadataAcceptedValues).values !== undefined;
};

export const getColumnTestConfigFromYml = (
  allTests: any[] | undefined,
  kwargs:
    | TestMetadataAcceptedValues
    | TestMetadataRelationships
    | { [x: string]: unknown },
  testName: string,
) => {
  const testsByTestName = allTests?.filter((t: any) => {
    if (typeof t === "string") {
      return t === testName;
    }
    const [key] = Object.keys(t);
    return key === testName;
  });

  const testWithRightConfigValues = testsByTestName?.find((t: any) => {
    if (typeof t === "string") {
      return t === testName;
    }

    if (isRelationship(kwargs)) {
      return (
        kwargs.field === t.relationships.field &&
        kwargs.to === t.relationships.to
      );
    }

    if (isAcceptedValues(kwargs)) {
      return (
        kwargs.values?.sort().toString() ===
        t.accepted_values.values.sort().toString()
      );
    }

    // For multiple tests with same name but diff config from  external packages like dbt_utils,
    // match all the config values
    const { model, column_name, ...rest } = kwargs;
    return Object.entries(rest).every(([k, v]) => t[testName][k] === v);
  });

  if (isRelationship(kwargs)) {
    return (
      testWithRightConfigValues as
        { relationships: TestMetadataAcceptedValues } | undefined
    )?.["relationships"];
  }

  if (isAcceptedValues(kwargs)) {
    return (
      testWithRightConfigValues as
        { accepted_values: TestMetadataAcceptedValues } | undefined
    )?.["accepted_values"];
  }

  if (testWithRightConfigValues?.[testName]) {
    return {
      [testName]: testWithRightConfigValues?.[testName],
    };
  }
};

export function getFormattedDateTime(): string {
  const now = new Date();

  const date = now.toLocaleDateString("en-GB").replace(/\//g, "-");
  const time = now
    .toLocaleTimeString("en-GB", { hour12: false })
    .replace(/:/g, "-");

  return `${date}-${time}`;
}

export const getStringSizeInMb = (str: string): number => {
  let sizeInBytes = 0;
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    if (charCode <= 0x7f) {
      sizeInBytes += 1;
    } else if (charCode <= 0x7ff) {
      sizeInBytes += 2;
    } else if (charCode <= 0xffff) {
      sizeInBytes += 3;
    } else {
      sizeInBytes += 4;
    }
  }
  const sizeInMB = sizeInBytes / (1024 * 1024);
  return sizeInMB;
};

interface YamlModel {
  key?: { value: string };
  value?: { items?: Array<YamlModelItem> };
}

interface YamlModelItem {
  items?: Array<{
    key?: { value: string };
    value?: { toString(): string };
  }>;
  range?: [number, number];
}

export function getCurrentlySelectedModelNameInYamlConfig(): string {
  if (
    window.activeTextEditor === undefined ||
    window.activeTextEditor.document.languageId !== "yaml"
  ) {
    return "";
  }

  try {
    const parsedYaml = parseDocument(
      window.activeTextEditor.document.getText(),
    );
    if (parsedYaml.contents === null) {
      return "";
    }
    const cursorPosition = window.activeTextEditor.selection.active;
    const offset = window.activeTextEditor.document.offsetAt(cursorPosition);

    const contents = parsedYaml.contents as { items?: Array<YamlModel> };
    if (!contents.items) {
      return "";
    }

    const modelsNode = contents.items.find(
      (item) => item?.key?.value === "models",
    );
    if (!modelsNode?.value?.items) {
      return "";
    }

    // Find a model at the current position
    for (const model of modelsNode.value.items) {
      if (!model?.items) {
        continue;
      }

      const nameNode = model.items.find((item) => item?.key?.value === "name");
      if (!nameNode?.value) {
        continue;
      }

      if (model.range && model.range[0] < offset && offset < model.range[1]) {
        return nameNode.value.toString();
      }
    }
  } catch {
    // A YAML document mid-edit does not parse; no model is selected.
  }
  return "";
}

export function removeProtocol(input: string): string {
  return input.replace(/^[^:]+:\/\//, "");
}

const MEDIUM_DEPTH_THRESHOLD = 5;
const HIGH_DEPTH_THRESHOLD = 10;
const LOW_DEPTH_COLOR = "#00ff00";
const MEDIUM_DEPTH_COLOR = "#ffa500";
const HIGH_DEPTH_COLOR = "#ff0000";

export function getDepthColor(depth: number): string {
  if (depth >= HIGH_DEPTH_THRESHOLD) {
    return HIGH_DEPTH_COLOR;
  }
  if (depth >= MEDIUM_DEPTH_THRESHOLD) {
    return MEDIUM_DEPTH_COLOR;
  }
  return LOW_DEPTH_COLOR;
}

/**
 * Extract the dbt subcommand from a full command string.
 * "dbt build --select model" → "build"
 */
export function extractDbtSubcommand(command: string): string {
  return command.startsWith("dbt ") ? command.split(" ")[1] : command;
}
