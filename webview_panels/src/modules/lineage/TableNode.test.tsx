import type { lineage } from "@fusion-power-user/webview-contract";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";
import { cardTitle } from "./card";
import { geometry } from "./layout";
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
    const title = container.querySelector("[class*=label]");
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

describe("table node name block", () => {
  const drawCard = (
    table: Partial<lineage.LineageTable>,
    {
      isStart = false,
      selected = false,
      columns,
    }: {
      isStart?: boolean;
      selected?: boolean;
      columns?: lineage.LineageColumn[];
    } = {},
  ) => {
    const props = {
      id: "model.fg.summary_mart",
      selected,
      data: {
        table: {
          table: "model.fg.summary_mart",
          label: "summary_mart",
          nodeType: "model",
          childCount: 0,
          parentCount: 0,
          tests: [],
          path: "models/mart_summary.sql",
          packageName: "fg",
          refName: "mart_summary",
          database: "DEV",
          schema: "marts",
          ...table,
        },
        columns,
        isStart,
        title: "alias",
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

  it("titles the card with the alias, then the file and the package and type chips", () => {
    const { container } = drawCard({});
    expect(container.querySelector("[class*=label]")?.textContent).toBe(
      "summary_mart",
    );
    expect(container.querySelector("[class*=file]")?.textContent).toBe(
      "mart_summary",
    );
    expect(screen.getByText("fg")).toBeTruthy();
    expect(container.querySelector("[class*=typeTag]")?.textContent).toBe(
      "model",
    );
  });

  it("puts the path, the ref call and the relation in the tooltip", () => {
    const { container } = drawCard({});
    const title = container
      .querySelector("[class*=names]")
      ?.getAttribute("title");
    expect(title).toContain("models/mart_summary.sql");
    expect(title).toContain("ref('mart_summary')");
    expect(title).toContain("relation: DEV.marts.summary_mart");
  });

  it("takes the package from the unique ID when no package name is set", () => {
    const { container } = drawCard({
      table: "metric.fg.revenue",
      label: "revenue",
      nodeType: "metric",
      packageName: undefined,
    });
    expect(container.querySelector("[class*=tags]")?.textContent).toBe(
      "fgmetric",
    );
  });

  it("leaves the file line out when the title is the file name", () => {
    const { container } = drawCard({
      label: "orders",
      path: "models/orders.sql",
      refName: undefined,
    });
    expect(container.querySelector("[class*=file]")).toBeNull();
  });

  it("shows the relation line only on the start card and a selected card", () => {
    const relation = (isStart: boolean, selected: boolean) =>
      drawCard({}, { isStart, selected }).container.querySelector(
        "[class*=subtitle]",
      );
    expect(relation(false, false)).toBeNull();
    expect(relation(true, false)).not.toBeNull();
    expect(relation(false, true)).not.toBeNull();
  });

  it("grows the header by the relation line only on the start card and a selected card", () => {
    const header = (isStart: boolean, selected: boolean) =>
      drawCard({}, { isStart, selected }).container.querySelector(
        "[data-table] > [class*=header]",
      )?.className;
    expect(header(false, false)).not.toContain("headerRelation");
    expect(header(true, false)).toContain("headerRelation");
    expect(header(false, true)).toContain("headerRelation");
  });

  it("marks a card with no column list, which takes the header clearance", () => {
    const node = (columns?: lineage.LineageColumn[]) =>
      drawCard({}, { columns }).container.querySelector("[data-table]")
        ?.className;
    expect(node()).toContain("noColumns");
    expect(node([])).not.toContain("noColumns");
  });
});

/** The stylesheet's declarations for the rule whose selector starts a line. */
const rule = (selector: string): string => {
  const css = readFileSync(
    join(import.meta.dirname, "lineageGraph.module.css"),
    "utf8",
  );
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

/** The pixel value of `property` in a rule's declarations. */
const px = (declarations: string, property: string): number => {
  const match = new RegExp(`(?:^|[\\s;{])${property}:\\s*(\\d+)px`).exec(
    declarations,
  );
  expect(match, `${property} in ${declarations}`).not.toBeNull();
  return Number(match?.[1]);
};

describe("table node header geometry", () => {
  it("keeps the header's CSS heights in step with geometry", () => {
    const header = rule(".header");
    const nameBlock = px(rule(".names"), "height");
    const padding = px(header, "padding");
    const border = px(header, "border-bottom");
    // The header is a content box: the name block, its padding and its border.
    expect(px(header, "height")).toBe(nameBlock);
    expect(nameBlock + 2 * padding + border).toBe(geometry.headerHeight);
    // The relation line is a row gap and the subtitle's line.
    const relationLine =
      px(rule(".subtitle"), "line-height") + px(header, "gap");
    expect(relationLine).toBe(geometry.relationHeight);
    expect(px(rule(".headerRelation"), "height")).toBe(
      nameBlock + relationLine,
    );
    expect(
      px(rule(".node.noColumns .header"), "padding-bottom") - padding,
    ).toBe(geometry.headerClearance);
  });
});
