import type { Table } from "@altimateai/ui-components/lineage";

// The vendored lineage component draws dbt children on its right side yet calls them upstream;
// this file translates to and from its names and goes away with the component.

/** A lineage table as the extension host sends it. */
export type HostTable = Omit<Table, "upstreamCount" | "downstreamCount"> & {
  childCount: number;
  parentCount: number;
};

/** Host request name for each table lookup the component makes. */
export const componentTableRequests = {
  upstreamTables: "childTables",
  downstreamTables: "parentTables",
} as const;

export const isComponentTableRequest = (
  url: string,
): url is keyof typeof componentTableRequests =>
  Object.prototype.hasOwnProperty.call(componentTableRequests, url);

/** Converts a host table to the component's field names. */
export const toComponentTable = ({
  childCount,
  parentCount,
  ...rest
}: HostTable): Table => ({
  ...rest,
  upstreamCount: childCount,
  downstreamCount: parentCount,
});
