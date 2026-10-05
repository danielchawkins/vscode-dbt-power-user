import { fireEvent, render, screen } from "@testing-library/react";
import { act, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Button,
  Drawer,
  DrawerRef,
  Nav,
  NavItem,
  NavLink,
  PopoverWithButton,
  Tooltip,
} from "..";

describe("uiCore native components", () => {
  it("marks the selected tab active, the class the panel smoke reads", () => {
    render(
      <Nav>
        <NavItem>
          <NavLink active>Preview</NavLink>
        </NavItem>
        <NavItem>
          <NavLink>SQL</NavLink>
        </NavItem>
      </Nav>,
    );
    const [preview, sql] = screen.getAllByRole("tab");
    expect(preview).toHaveClass("nav-link", "active");
    expect(preview).toHaveAttribute("aria-selected", "true");
    expect(sql).not.toHaveClass("active");
  });

  it("gives a button its color and outline classes and defaults to type button", () => {
    render(
      <>
        <Button color="primary">Save</Button>
        <Button outline>Cancel</Button>
      </>,
    );
    expect(screen.getByText("Save")).toHaveClass("btn", "btn-primary");
    expect(screen.getByText("Save")).toHaveAttribute("type", "button");
    expect(screen.getByText("Cancel")).toHaveClass("btn-outline-secondary");
  });

  it("shows an icon button's label only while hovered", () => {
    render(<Button icon={<i data-testid="icon" />}>Clear results</Button>);
    const button = screen.getByRole("button");
    expect(button).not.toHaveTextContent("Clear results");
    fireEvent.mouseEnter(button);
    expect(button).toHaveTextContent("Clear results");
  });

  it("mounts drawer content only while open and closes on Escape", () => {
    const ref = createRef<DrawerRef>();
    const onClose = vi.fn();
    render(
      <Drawer ref={ref} title="Help" onClose={onClose}>
        <p>content</p>
      </Drawer>,
    );
    expect(screen.queryByText("content")).toBeNull();
    act(() => ref.current?.open());
    expect(screen.getByText("content")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("content")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a tooltip on hover and focus", () => {
    render(
      <Tooltip title="Click to add">
        <button type="button">unique</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(screen.getByText("unique"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Click to add");
  });

  it("renders a tooltip through a portal, links it to the anchor, and closes it on Escape", () => {
    render(
      <Tooltip title="Click to add">
        <button type="button">anchor</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText("anchor"));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.parentElement).toBe(document.body);
    expect(screen.getByText("anchor").parentElement).toHaveAttribute(
      "aria-describedby",
      tooltip.id,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps a tooltip open when focus moves within its anchor", () => {
    render(
      <Tooltip title="Both">
        <button type="button">first</button>
        <button type="button">second</button>
      </Tooltip>,
    );
    const first = screen.getByText("first");
    fireEvent.focus(first);
    fireEvent.blur(first, { relatedTarget: screen.getByText("second") });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(first, { relatedTarget: document.body });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("moves focus into a popover on open and closes it on Escape", () => {
    render(
      <PopoverWithButton button={<button type="button">open</button>}>
        {() => <input aria-label="field" />}
      </PopoverWithButton>,
    );
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByLabelText("field")).toHaveFocus();
    expect(screen.getByRole("dialog").parentElement).toBe(document.body);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
