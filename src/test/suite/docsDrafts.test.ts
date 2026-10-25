import { describe, expect, it } from "vitest";
import { DocsDrafts } from "../../features/docs/docsDrafts";

const docs = (filePath: string, description: string) => ({
  name: "orders",
  description,
  columns: [],
  filePath,
});

describe("documentation drafts", () => {
  const draft = {
    docs: docs("/p/models/orders.sql", "unsaved edit"),
    tests: [{ key: "not_null_orders_id", column_name: "id" }],
  };

  it("forgets a draft the page clears, after a save, discard or revert", () => {
    const drafts = new DocsDrafts();
    drafts.set("/p/models/orders.sql", draft);

    drafts.set("/p/models/orders.sql", undefined);

    expect(drafts.get("/p/models/orders.sql")).toBeUndefined();
  });

  it("keeps drafts of other models apart", () => {
    const drafts = new DocsDrafts();
    drafts.set("/p/models/customers.sql", {
      docs: docs("/p/models/customers.sql", "other"),
    });

    expect(drafts.get("/p/models/orders.sql")).toBeUndefined();
  });

  it("forgets the drafts of a removed project only", () => {
    const drafts = new DocsDrafts();
    drafts.set("/p/models/orders.sql", draft);
    drafts.set("/q/models/orders.sql", {
      docs: docs("/q/models/orders.sql", "kept"),
    });

    drafts.forgetProject("/p");

    expect(drafts.held()).toEqual(["/q/models/orders.sql"]);
  });

  it("keeps a model whose path only starts with the removed root's name", () => {
    const drafts = new DocsDrafts();
    drafts.set("/p/models/orders.sql", draft);
    drafts.set("/pq/models/orders.sql", {
      docs: docs("/pq/models/orders.sql", "sibling"),
    });

    drafts.forgetProject("/p");

    expect(drafts.held()).toEqual(["/pq/models/orders.sql"]);
  });

  it("answers the draft's columns for a model, else the YAML's", () => {
    const drafts = new DocsDrafts();
    const yaml = {
      filePath: "/p/models/orders.sql",
      columns: [{ name: "id", type: "integer" }],
    };
    expect(drafts.columnsFor(yaml)).toBe(yaml.columns);

    drafts.set(yaml.filePath, {
      docs: {
        ...docs(yaml.filePath, "unsaved edit"),
        columns: [{ name: "id" }],
      },
      tests: [],
    });

    expect(drafts.columnsFor(yaml)).toEqual([{ name: "id" }]);
  });
});
