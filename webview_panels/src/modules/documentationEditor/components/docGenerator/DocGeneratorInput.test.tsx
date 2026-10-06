import { render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it } from "vitest";
import { DocumentationContext } from "../../context";
import {
  documentationReducer,
  initialState,
} from "../../state/documentationReducer";
import { EntityType } from "../../state/entityType";
import { DBTDocumentation, Source } from "../../state/types";
import DocGeneratorInput from "./DocGeneratorInput";

const orders = (description: string): DBTDocumentation => ({
  name: "orders",
  description,
  columns: [{ name: "id", description, generated: false, source: Source.YAML }],
  generated: false,
  filePath: "/models/orders.sql",
});

const Harness = ({
  entity,
}: {
  entity: DBTDocumentation | DBTDocumentation["columns"][number];
}): React.JSX.Element => {
  const [state, dispatch] = useReducer(documentationReducer, initialState);
  return (
    <DocumentationContext.Provider value={{ state, dispatch }}>
      <DocGeneratorInput
        entity={entity}
        type={EntityType.COLUMN}
        title="id"
        placeholder="Describe"
      />
    </DocumentationContext.Provider>
  );
};

const textarea = (): HTMLTextAreaElement =>
  screen.getByPlaceholderText("Describe") as HTMLTextAreaElement;

/** The row count the component set; happy-dom reflects the attribute as a string. */
const rows = (): number => Number(textarea().getAttribute("rows"));

describe("DocGeneratorInput", () => {
  it("renders an empty description without throwing on the row count", () => {
    const [column] = orders("").columns;
    render(<Harness entity={column} />);
    expect(textarea().value).toBe("");
    expect(rows()).toBe(1);
  });

  it("renders a description, with at least one row when the width is unknown", () => {
    const [column] = orders("one line").columns;
    render(<Harness entity={column} />);
    expect(textarea().value).toBe("one line");
    expect(rows()).toBeGreaterThanOrEqual(1);
  });

  it("adds a row for each line break", () => {
    const [column] = orders("a\nb\nc").columns;
    render(<Harness entity={column} />);
    expect(rows()).toBeGreaterThanOrEqual(2);
  });

  it("takes a changed description from its entity", () => {
    const [before] = orders("old").columns;
    const [after] = orders("new").columns;
    const { rerender } = render(<Harness entity={before} />);
    expect(textarea().value).toBe("old");
    rerender(<Harness entity={after} />);
    expect(textarea().value).toBe("new");
  });

  it("marks a description that differs from the saved one as modified", () => {
    const saved = orders("saved");
    const [edited] = orders("edited").columns;
    const Dirty = (): React.JSX.Element => {
      const [state, dispatch] = useReducer(documentationReducer, {
        ...initialState,
        incomingDocsData: { docs: saved },
        currentDocsData: saved,
      });
      return (
        <DocumentationContext.Provider value={{ state, dispatch }}>
          <DocGeneratorInput
            entity={edited}
            type={EntityType.COLUMN}
            title="id"
            placeholder="Describe"
          />
        </DocumentationContext.Provider>
      );
    };
    render(<Dirty />);
    expect(screen.getByText("modified")).toBeInTheDocument();
  });
});
