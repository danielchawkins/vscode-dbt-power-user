import { readSetting } from "../settings";

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
