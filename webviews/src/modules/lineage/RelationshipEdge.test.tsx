import type { lineage } from "@fusion-power-user/webview-contract";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EdgeProps } from "@xyflow/react";
import type * as XyflowReact from "@xyflow/react";
import { Position } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import {
  type RelationshipEdge as RelationshipEdgeType,
  RelationshipEdgeView,
} from "./RelationshipEdge";
import { endMark } from "./relationshipMarks";

// xyflow portals the tooltip into its label layer, which only exists inside a laid-out flow. happy-dom
// lays nothing out, so the label renders in place.
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof XyflowReact>()),
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => children,
}));

const ref: lineage.LineageRef = {
  id: "meta:child[0]",
  from: { table: "child", columns: ["hub_id"] },
  to: { table: "hub", columns: ["id"] },
  cardinality: "many-to-one",
  source: "meta",
};

const props = {
  id: "r1",
  sourceX: 0,
  sourceY: 0,
  sourcePosition: "right",
  targetX: 300,
  targetY: 0,
  targetPosition: "left",
  data: { ref },
  type: "relationship",
  selected: false,
  selectable: true,
  deletable: true,
  zIndex: 0,
  animated: false,
  markerEnd: undefined,
  markerStart: undefined,
  interactionWidth: 20,
  source: "hub",
  target: "child",
} as unknown as EdgeProps<RelationshipEdgeType>;

describe("relationship edge", () => {
  it("draws the to end's mark at the source handle and the from end's at the target", () => {
    const { container } = render(
      <svg>
        <RelationshipEdgeView {...props} />
      </svg>,
    );
    // The many-to-one fixture: the referenced (one) end sits at the edge's source, the declaring (many) end at
    // its target.
    const sourceEnd = [props.sourceX, props.sourceY] as const;
    const targetEnd = [props.targetX, props.targetY] as const;
    const mark = container.querySelector('path[class*="mark"]');
    expect(mark?.getAttribute("d")).toBe(
      endMark("one", ...sourceEnd, Position.Right) +
        " " +
        endMark("many", ...targetEnd, Position.Left),
    );
  });

  it("draws a routed relationship along its path, with the marks at the path's card ends", () => {
    const routed = {
      d: "M10,20 L10,50 L200,50 L200,80",
      labelAt: { x: 105, y: 50 },
      source: { x: 10, y: 20, position: Position.Bottom },
      target: { x: 200, y: 80, position: Position.Top },
    };
    const { container } = render(
      <svg>
        <RelationshipEdgeView {...props} data={{ ref, routed }} />
      </svg>,
    );
    const line = container.querySelector('path[class*="line"]');
    expect(line?.getAttribute("d")).toBe(routed.d);
    const mark = container.querySelector('path[class*="mark"]');
    expect(mark?.getAttribute("d")).toBe(
      endMark("one", 10, 20, Position.Bottom) +
        " " +
        endMark("many", 200, 80, Position.Top),
    );
  });

  it("draws an unrouted relationship dashed and straight between its handles, never as a curve", () => {
    const { container } = render(
      <svg>
        <RelationshipEdgeView {...props} data={{ ref }} />
      </svg>,
    );
    const line = container.querySelector('path[class*="line"]');
    expect(line?.getAttribute("d")).toBe("M 0 0 L 300 0");
    expect((line as SVGElement | null)?.style.strokeDasharray).toBe("6 4");
  });

  it("shows its columns and declaring source when hovered", () => {
    const { container } = render(
      <svg>
        <RelationshipEdgeView {...props} />
      </svg>,
    );
    expect(screen.queryByText("hub_id -> id")).toBeNull();

    // The hit path is drawn last, above the line and marks.
    const hit = [...container.querySelectorAll("path")].at(-1);
    expect(hit).toBeTruthy();
    fireEvent.pointerEnter(hit!);

    expect(screen.getByText("hub_id -> id")).toBeTruthy();
    expect(screen.getByText("declared in meta.relationships")).toBeTruthy();
  });
});
