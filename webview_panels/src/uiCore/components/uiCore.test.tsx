import { fireEvent, render, screen } from "@testing-library/react";
import { act, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button, Drawer, DrawerRef, Nav, NavItem, NavLink, Tooltip } from "..";

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
});
