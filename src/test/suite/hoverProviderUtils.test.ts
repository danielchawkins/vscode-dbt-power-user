import {
  generateHoverMarkdownString,
  generateMacroHoverMarkdown,
} from "../../hover_provider/utils";

describe("Hover Provider Utils", () => {
  describe("generateHoverMarkdownString", () => {
    it("renders model with column fragments, no openChat or trailing separator", () => {
      const model = {
        name: "orders",
        description: "Customer orders",
        columns: {
          order_id: {
            name: "order_id",
            data_type: "int",
            description: "Unique order ID",
          },
          customer_id: {
            name: "customer_id",
            data_type: "int",
            description: "Customer reference",
          },
        },
        unique_id: "model.test.orders",
        path: "/path/to/orders.yml",
      } as any;

      const modelMarkdown = generateHoverMarkdownString(model, "model").value;

      expect(modelMarkdown).toContain("(column)&nbsp;</span><span>order_id");
      expect(modelMarkdown).toContain("-&nbsp;int");
      expect(modelMarkdown).toContain("Unique order ID");
      expect(modelMarkdown).toContain("(column)&nbsp;</span><span>customer_id");
      expect(modelMarkdown).toContain("Customer reference");
      expect(modelMarkdown).not.toContain("command:altimate.openChat");
      expect(modelMarkdown).not.toMatch(/---\s*$/);
    });

    it("renders source with column fragments, no openChat or trailing separator", () => {
      const source = {
        name: "raw_users",
        description: "Raw user data",
        columns: {
          id: { name: "id", data_type: "bigint", description: "User ID" },
        },
        unique_id: "source.test.raw.users",
        path: "/path/to/sources.yml",
      } as any;

      const sourceMarkdown = generateHoverMarkdownString(
        source,
        "source",
      ).value;

      expect(sourceMarkdown).toContain("(column)&nbsp;</span><span>id");
      expect(sourceMarkdown).toContain("-&nbsp;bigint");
      expect(sourceMarkdown).toContain("User ID");
      expect(sourceMarkdown).not.toContain("command:altimate.openChat");
      expect(sourceMarkdown).not.toMatch(/---\s*$/);
    });
  });

  describe("generateMacroHoverMarkdown", () => {
    it("renders macro args, references, dependencies, no openChat or trailing separator", () => {
      const macro = {
        name: "generate_alias",
        description: "Generate table alias",
        unique_id: "macro.test.generate_alias",
        arguments: [
          { name: "name", type: "string", description: "Alias name" },
          { name: "quote", type: "boolean", description: "Quote name" },
        ],
        depends_on: {
          macros: ["macro.test.helper"],
          nodes: ["model.test.base"],
        },
      } as any;

      const refBy = [
        {
          name: "stg_customers",
          unique_id: "model.test.stg_customers",
          path: "/path/to/stg_customers.sql",
        } as any,
      ];

      const helper = {
        name: "helper",
        unique_id: "macro.test.helper",
        path: "/path/to/helper.sql",
      } as any;

      const depModel = {
        name: "base",
        unique_id: "model.test.base",
        path: "/path/to/base.sql",
      } as any;

      const event = {
        macroMetaMap: new Map([["macro.test.helper", helper]]),
        nodeMetaMap: { nodes: () => [depModel] },
      } as any;

      const markdown = generateMacroHoverMarkdown(macro, refBy, event).value;

      expect(markdown).toContain("(argument)&nbsp;</span><span>name");
      expect(markdown).toContain("-&nbsp;string");
      expect(markdown).toContain("Alias name");
      expect(markdown).toContain("(argument)&nbsp;</span><span>quote");
      expect(markdown).toContain("-&nbsp;boolean");
      expect(markdown).toContain("[stg_customers](");
      expect(markdown).toContain("[helper](");
      expect(markdown).toContain("[base](");
      expect(markdown).not.toContain("command:altimate.openChat");
      expect(markdown).not.toMatch(/---\s*$/);
    });
  });
});
