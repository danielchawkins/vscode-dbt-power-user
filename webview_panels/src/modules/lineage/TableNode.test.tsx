import { render, screen } from "@testing-library/react";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";
import { cardTitle } from "./card";
import { TableNode } from "./TableNode";

/** The length `cardTitle` shortens a long zoomed-out title to. */
const ZOOMED_TITLE_MAX = cardTitle(
  { table: "t", label: "x".repeat(100), nodeType: "model" } as Parameters<
    typeof cardTitle
  >[0],
  "alias",
  true,
).length;

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

describe("table node semantic zoom", () => {
  const ZoomTo = ({ zoom }: { zoom: number }) => {
    const store = useStoreApi();
    useLayoutEffect(() => {
      store.setState({ transform: [0, 0, zoom] });
    }, [store, zoom]);
    return null;
  };

  const drawAt = (zoom: number) => {
    const props = {
      id: "model.p.a",
      data: {
        table: {
          table: "model.p.a",
          label: "stg_a_long_table_name__with_a_long_suffix",
          nodeType: "model",
          childCount: 0,
          parentCount: 0,
          tests: [],
        },
        columns: [{ name: "id", datatype: "int" }],
        isStart: false,
        expanded: { parents: false, children: false },
        pending: { parents: false, children: false },
        hidden: { parents: 0, children: 0 },
        chips: [],
        traced: [],
      },
    } as unknown as React.ComponentProps<typeof TableNode>;
    return render(
      <ReactFlowProvider>
        <ZoomTo zoom={zoom} />
        <TableNode {...props} />
      </ReactFlowProvider>,
    );
  };

  it("below 50% zoom keeps the columns mounted and shortens the title", () => {
    const { container } = drawAt(0.3);
    expect(container.querySelector("[data-table]")?.className).toContain(
      "zoomedOut",
    );
    expect(screen.getByTestId("lineage-columns")).toBeTruthy();
    expect(container.querySelectorAll(".react-flow__handle").length).toBe(4);
    const title = container.querySelector("span[title]:not([class*=type])");
    expect(title?.textContent?.length).toBe(ZOOMED_TITLE_MAX);
  });

  it("at zoom 1 renders the full card", () => {
    const { container } = drawAt(1);
    expect(container.querySelector("[data-table]")?.className).not.toContain(
      "zoomedOut",
    );
    expect(
      screen.getByText(/^stg_a_long.*suffix$/).textContent?.length,
    ).toBeGreaterThan(ZOOMED_TITLE_MAX);
  });
});
