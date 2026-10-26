import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GroupChip } from "./expansionGroups";
import { GroupChips } from "./GroupChips";
import type { TableActions } from "./viewModel";
import { TableActionsContext } from "./viewModel";

const chip = (label: string, drawn = 2, total = 2): GroupChip => ({
  id: `group:${label}`,
  table: "hub",
  label,
  drawn,
  total,
});

const CHIPS = ["alpha", "beta", "gamma", "delta", "epsilon"].map((label) =>
  chip(label),
);

const actions = () => ({
  toggleExpansion: vi.fn(),
  showMore: vi.fn(),
  openGroup: vi.fn(),
  showMoreInGroup: vi.fn(),
  closeGroup: vi.fn(),
  toggleColumns: vi.fn(),
  selectColumn: vi.fn(),
  openDetails: vi.fn(),
  openFile: vi.fn(),
});

/** Captures the React Flow store, so a test can move the viewport as a pan or zoom does. */
let store: ReturnType<typeof useStoreApi> | undefined;
const StoreSpy = () => {
  const api = useStoreApi();
  useLayoutEffect(() => {
    store = api;
  }, [api]);
  return null;
};

const draw = (chips: GroupChip[], table: TableActions = actions()) =>
  render(
    <ReactFlowProvider>
      <StoreSpy />
      <TableActionsContext value={table}>
        <GroupChips chips={chips} />
      </TableActionsContext>
    </ReactFlowProvider>,
  );

describe("GroupChips", () => {
  it("draws nothing for no groups", () => {
    const { container } = draw([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws the next members of a group in the popover from its +K button", async () => {
    const user = userEvent.setup();
    const table = actions();
    draw([...CHIPS.slice(0, 4), chip("epsilon", 1, 3)], table);
    await user.click(screen.getByRole("button", { name: "+2 more" }));
    await user.click(
      screen.getByRole("button", { name: "Show 2 more in epsilon" }),
    );
    expect(table.showMoreInGroup).toHaveBeenCalledWith("group:epsilon");
  });

  it("closes the popover when the canvas moves", async () => {
    const user = userEvent.setup();
    draw(CHIPS);
    await user.click(screen.getByRole("button", { name: "+2 more" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => {
      store?.setState({ transform: [10, 20, 1.5] });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
