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
