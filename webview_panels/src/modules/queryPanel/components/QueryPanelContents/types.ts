export const QueryPanelTitleTabState = {
  Preview: 0,
  Sql: 1,
  QueryHistory: 2,
} as const;
export type QueryPanelTitleTabState =
  (typeof QueryPanelTitleTabState)[keyof typeof QueryPanelTitleTabState];

export const isQueryPanelTitleTabState = (
  value: unknown,
): value is QueryPanelTitleTabState =>
  (Object.values(QueryPanelTitleTabState) as unknown[]).includes(value);
