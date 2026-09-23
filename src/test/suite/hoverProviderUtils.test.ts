import { MarkdownString } from "vscode";
import {
  generateHoverMarkdownString,
  generateMacroHoverMarkdown,
} from "../../hover_provider/utils";

// Add methods to MarkdownString mock for testing
Object.defineProperty(MarkdownString.prototype, "appendMarkdown", {
  value: function (value: string) {
    this.value += value;
  },
});
Object.defineProperty(MarkdownString.prototype, "appendText", {
  value: function (value: string) {
    this.value += value;
  },
});
Object.defineProperty(MarkdownString.prototype, "supportThemeIcons", {
  value: true,
  writable: true,
});

describe("Hover Provider Utils", () => {
  describe("generateHoverMarkdownString", () => {
    it("generates hover markdown for model without openChat links", () => {
      const nodeMetaType = {
        name: "my_model",
        description: "A test model",
        columns: {
          col1: {
            name: "id",
            data_type: "int",
            description: "Primary key",
          },
          col2: {
            name: "name",
            data_type: "string",
            description: "User name",
          },
        },
        unique_id: "model.test.my_model",
        path: "/path/to/model.yml",
      } as any;

      const content = generateHoverMarkdownString(nodeMetaType, "model");

      expect(content).toBeInstanceOf(MarkdownString);
      expect(content.isTrusted).toBe(true);
      expect(content.supportHtml).toBe(true);

      const markdown = content.value;
      expect(markdown).toContain("my_model");
      expect(markdown).toContain("A test model");
      expect(markdown).toContain("id");
      expect(markdown).toContain("int");
      expect(markdown).toContain("Primary key");
      expect(markdown).toContain("name");
      expect(markdown).toContain("string");
      expect(markdown).toContain("User name");

      // Verify no openChat links
      expect(markdown).not.toContain("command:altimate.openChat");
      expect(markdown).not.toContain("Explain transformation");
    });

    it("generates hover markdown for source without openChat links", () => {
      const sourceMetaType = {
        name: "my_source",
        description: "External data source",
        columns: {
          col1: {
            name: "id",
            data_type: "bigint",
            description: "Row ID",
          },
        },
        unique_id: "source.test.my_source.table1",
        path: "/path/to/source.yml",
      } as any;

      const content = generateHoverMarkdownString(sourceMetaType, "source");

      const markdown = content.value;
      expect(markdown).toContain("my_source");
      expect(markdown).toContain("External data source");
      expect(markdown).toContain("id");
      expect(markdown).toContain("Row ID");
      expect(markdown).not.toContain("command:altimate.openChat");
    });
  });

  describe("generateMacroHoverMarkdown", () => {
    it("generates macro hover markdown with references without openChat links", () => {
      const macroMetaData = {
        name: "my_macro",
        description: "A utility macro",
        unique_id: "macro.test.my_macro",
        arguments: [
          {
            name: "arg1",
            type: "string",
            description: "First argument",
          },
        ],
        depends_on: {
          macros: [],
          nodes: [],
        },
      } as any;

      const referencedBy = [
        {
          name: "model_a",
          unique_id: "model.test.model_a",
          path: "/path/to/model_a.sql",
        } as any,
      ];

      const event = {
        macroMetaMap: new Map(),
        nodeMetaMap: { nodes: () => [] },
      } as any;

      const content = generateMacroHoverMarkdown(
        macroMetaData,
        referencedBy,
        event,
      );

      const markdown = content.value;
      expect(markdown).toContain("my_macro");
      expect(markdown).toContain("A utility macro");
      expect(markdown).toContain("arg1");
      expect(markdown).toContain("string");
      expect(markdown).toContain("First argument");
      expect(markdown).toContain("Referenced by");
      expect(markdown).toContain("model_a");

      // Verify no openChat links
      expect(markdown).not.toContain("command:altimate.openChat");
      expect(markdown).not.toContain("Explain what this macro does");
      expect(markdown).not.toContain("Find risky usages");
    });

    it("generates macro hover markdown with dependencies without openChat links", () => {
      const macroMetaData = {
        name: "my_macro",
        description: "Macro with dependencies",
        unique_id: "macro.test.my_macro",
        arguments: [],
        depends_on: {
          macros: ["macro.test.dep_macro"],
          nodes: ["model.test.dep_model"],
        },
      } as any;

      const depMacro = {
        name: "dep_macro",
        unique_id: "macro.test.dep_macro",
        path: "/path/to/dep_macro.sql",
      } as any;

      const depModel = {
        name: "dep_model",
        unique_id: "model.test.dep_model",
        path: "/path/to/dep_model.sql",
      } as any;

      const event = {
        macroMetaMap: new Map([["macro.test.dep_macro", depMacro]]),
        nodeMetaMap: {
          nodes: () => [depModel],
        },
      } as any;

      const content = generateMacroHoverMarkdown(macroMetaData, [], event);

      const markdown = content.value;
      expect(markdown).toContain("my_macro");
      expect(markdown).toContain("Depends on");
      expect(markdown).toContain("dep_macro");
      expect(markdown).toContain("dep_model");

      // Verify no openChat links
      expect(markdown).not.toContain("command:altimate.openChat");
    });
  });
});
