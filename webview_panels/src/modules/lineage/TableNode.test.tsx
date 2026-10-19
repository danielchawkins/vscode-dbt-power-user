import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { TableNode } from "./TableNode";

const draw = (columnsNeedStrict: boolean) => {
  const props = {
    id: "model.p.a",
    data: {
      table: {
        table: "model.p.a",
        label: "a",
        nodeType: "model",
        childCount: 0,
        parentCount: 0,
        tests: [],
      },
      columns: [],
      isStart: true,
      expanded: { parents: false, children: false },
      pending: { parents: false, children: false },
      hidden: { parents: 0, children: 0 },
      chips: [],
      traced: [],
      columnsNeedStrict,
    },
  } as unknown as React.ComponentProps<typeof TableNode>;
  return render(
    <ReactFlowProvider>
      <TableNode {...props} />
    </ReactFlowProvider>,
  );
};

describe("table node empty column list", () => {
  it("asks for strict static analysis when the mode computes no columns", () => {
    draw(true);
    expect(
      screen.getByText("Columns need strict static analysis"),
    ).toBeTruthy();
  });

  it("says No columns otherwise", () => {
    draw(false);
    expect(screen.getByText("No columns")).toBeTruthy();
  });
});

describe("table node hidden cue", () => {
  const drawHidden = (hidden: boolean, isStart = false) => {
    const props = {
      id: "model.p.a",
      data: {
        table: {
          table: "model.p.a",
          label: "a",
          nodeType: "model",
          childCount: 0,
          parentCount: 0,
          tests: [],
          hidden,
        },
        columns: undefined,
        isStart,
        expanded: { parents: false, children: false },
        pending: { parents: false, children: false },
        hidden: { parents: 0, children: 0 },
        chips: [],
        traced: [],
      },
    } as unknown as React.ComponentProps<typeof TableNode>;
    return render(
      <ReactFlowProvider>
        <TableNode {...props} />
      </ReactFlowProvider>,
    );
  };

  it("marks a hidden card with an eye icon and a title saying why", () => {
    const { container } = drawHidden(true);
    expect(
      screen.getByTitle("Hidden from lineage by meta.lineage.hidden"),
    ).toBeTruthy();
    expect(container.querySelector(".codicon-eye-closed")).not.toBeNull();
    expect(container.querySelector("[data-table]")?.className).toContain(
      "hidden",
    );
  });

  it("shows no cue on a card that is not hidden", () => {
    const { container } = drawHidden(false);
    expect(container.querySelector(".codicon-eye-closed")).toBeNull();
    expect(container.querySelector("[data-table]")?.className).not.toContain(
      "hidden",
    );
  });

  it("shows no cue on a hidden start card, which the graph never hides", () => {
    const { container } = drawHidden(true, true);
    expect(container.querySelector(".codicon-eye-closed")).toBeNull();
    expect(
      screen.queryByText("Hidden from lineage by meta.lineage.hidden"),
    ).toBeNull();
    expect(container.querySelector("[data-table]")?.className).not.toContain(
      "hidden",
    );
  });
});
