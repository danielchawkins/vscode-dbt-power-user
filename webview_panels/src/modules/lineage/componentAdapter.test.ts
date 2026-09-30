import { describe, expect, it } from "vitest";
import {
  componentTableRequests,
  HostTable,
  isComponentTableRequest,
  toComponentTable,
} from "./componentAdapter";

describe("componentAdapter", () => {
  it("sends the component's upstream request for children and downstream for parents", () => {
    expect(componentTableRequests.upstreamTables).toBe("childTables");
    expect(componentTableRequests.downstreamTables).toBe("parentTables");
  });

  it("recognizes only the component's table requests", () => {
    expect(isComponentTableRequest("upstreamTables")).toBe(true);
    expect(isComponentTableRequest("downstreamTables")).toBe(true);
    expect(isComponentTableRequest("getColumns")).toBe(false);
    expect(isComponentTableRequest("toString")).toBe(false);
  });

  it("maps child count to upstream and parent count to downstream", () => {
    const host = {
      table: "model.p.a",
      label: "a",
      url: undefined,
      nodeType: "model",
      childCount: 3,
      parentCount: 1,
    } as unknown as HostTable;

    const table = toComponentTable(host);

    expect(table).toMatchObject({
      table: "model.p.a",
      upstreamCount: 3,
      downstreamCount: 1,
    });
    expect(table).not.toHaveProperty("childCount");
    expect(table).not.toHaveProperty("parentCount");
  });
});
