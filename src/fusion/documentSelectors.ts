/** Documents that can hold dbt SQL: models, macros and untitled scratch queries. */
export const DBT_SQL_SELECTOR = [
  { language: "jinja-sql", scheme: "file" },
  { language: "sql", scheme: "file" },
  { language: "jinja-sql", scheme: "untitled" },
];

/** YAML documents on disk: schema, properties and project files. */
export const DBT_YAML_SELECTOR = [{ language: "yaml", scheme: "file" }];
