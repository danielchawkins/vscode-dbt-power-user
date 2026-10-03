/** A `renderQuery` message as the host sends it (`packages/webview-contract/src/queryResults.ts`). */
export const renderQuery = {
  command: "renderQuery",
  columnNames: ["id", "label", "amount", "big_id", "payload", "note", "untyped"],
  columnTypes: ["Integer", "Text", "Number", "BigInteger", "Text", "Text", null],
  rows: Array.from({ length: 200 }, (_, i) => ({
    id: i + 1,
    label: ["alpha", "beta", "gamma", "delta"][i % 4],
    amount: Math.round((i * 37.5) % 1000) / 10,
    big_id: 9007199254740993n + BigInt(i),
    payload: JSON.stringify({ row: i, tags: ["a", "b"], nested: { ok: i % 2 === 0 } }),
    note: "a long free-text value that is wider than its column ".repeat(2) + i,
    untyped: i % 3 === 0 ? null : { value: i },
  })),
  raw_sql: "select * from {{ ref('orders') }}",
  compiled_sql: "select * from analytics.orders",
};

/** The `ViewerConfigUpdate` `PerspectiveViewer.tsx` restores today, under `@finos/perspective-viewer` 3.8. */
export function panelConfig(columnNames, columnTypes, theme) {
  const numberFormat = {
    minimumIntegerDigits: null,
    minimumFractionDigits: 0,
    maximumFractionDigits: 20,
    minimumSignificantDigits: null,
    maximumSignificantDigits: null,
    roundingPriority: null,
    roundingIncrement: null,
    roundingMode: null,
    trailingZeroDisplay: null,
    useGrouping: false,
    signDisplay: null,
  };
  const columns_config = Object.fromEntries(
    columnNames
      .filter((_, i) => columnTypes[i] === "Integer" || columnTypes[i] === "Number")
      .map((name) => [name, { number_format: numberFormat }]),
  );
  return {
    theme,
    title: "query result",
    columns: [...columnNames],
    columns_config,
    settings: false,
    plugin_config: { editable: false },
  };
}

/** A configuration `save()`d by `@finos/perspective-viewer` 3.8 with the datagrid sorted and grouped. */
export const savedByFinos38 = {
  version: "3.8.0",
  plugin: "Datagrid",
  plugin_config: { columns: {}, edit_mode: "READ_ONLY", scroll_lock: false },
  columns_config: {},
  settings: false,
  theme: "Pro Dark",
  title: "query result",
  group_by: ["label"],
  split_by: [],
  columns: ["amount", "id"],
  filter: [["amount", ">", 10]],
  sort: [["amount", "desc"]],
  expressions: {},
  aggregates: { amount: "sum", id: "count" },
};
