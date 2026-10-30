import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { controlRecorder } from "../../test/controlRecorder";
import {
  FILTER,
  HUB,
  node,
  openLineage,
  tableIds,
} from "../../test/lineageHarness";

/**
 * The projection snapshot: the cards, group cards and bands that are drawn, with their positions, and the edges that
 * are drawn, with their paths. It is recorded on the code before the visibility refactor and must not change after it:
 * a change here is a change a user can see.
 */

const { press, pressElement } = controlRecorder();

const byFirst = (a: unknown[], b: unknown[]) =>
  String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0;

/** Every drawn node and edge, each sorted by ID, with the position and the path the panel gave it. */
const projection = (container: HTMLElement) => ({
  nodes: Array.from(
    container.querySelectorAll<HTMLElement>(".react-flow__node"),
    (el) => [el.dataset.id, el.style.transform],
  ).sort(byFirst),
  edges: Array.from(
    container.querySelectorAll<HTMLElement>(".react-flow__edge"),
    (el) => [
      el.dataset.id,
      Array.from(el.querySelectorAll("path"), (path) => path.getAttribute("d")),
    ],
  ).sort(byFirst),
});

describe("lineage projection snapshot", () => {
  it("draws the start table and its dbt neighbours", async () => {
    const { container } = await openLineage();
    expect(projection(container)).toMatchSnapshot();
  });

  it("draws the column edges of a traced column", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Columns", node(container, "b"));
    const column = await waitFor(() =>
      node(container, "b").getByRole("button", { name: "id" }),
    );
    await pressElement(user, "button", "id", column);
    await waitFor(() =>
      expect(
        node(container, "b").getByRole("button", { name: "id" }).className,
      ).toMatch(/selected/),
    );
    expect(projection(container)).toMatchSnapshot();
  });

  it("moves no card when a card is selected", async () => {
    const { user, container } = await openLineage();
    const before = projection(container).nodes;
    await user.click(node(container, "b").getByText("b"));
    await waitFor(() =>
      expect(
        container.querySelector('.react-flow__node[data-id="b"]'),
      ).toHaveClass("selected"),
    );
    expect(projection(container).nodes).toEqual(before);
    expect(projection(container)).toMatchSnapshot();
  });

  it("draws the groups a capped expansion makes, then the members of an opened group", async () => {
    const { user, container } = await openLineage(
      { node: HUB, publication: "s:1" },
      { settings: { maxNeighbours: 2 } },
    );
    expect(projection(container)).toMatchSnapshot();

    await press(user, "button", "Open staging");
    await waitFor(() =>
      expect(tableIds(container)).toEqual(["hub", "s1", "s2"]),
    );
    expect(projection(container)).toMatchSnapshot();
  });

  it("draws a filtered-out table as a card with no edge to or from it", async () => {
    const { container } = await openLineage({
      node: FILTER,
      publication: "s:1",
    });
    expect(tableIds(container)).toEqual(["audit", "filter", "kept"]);
    expect(projection(container)).toMatchSnapshot();
  });

  it("draws only column and relationship edges under declared connections", async () => {
    const { container } = await openLineage(undefined, {
      settings: { connections: "declared" },
    });
    expect(projection(container)).toMatchSnapshot();
  });
});
