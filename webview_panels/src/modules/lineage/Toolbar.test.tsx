import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Toolbar from "./Toolbar";
import { resolveSettings } from "./viewModel";

const setup = () =>
  render(
    <div>
      <Toolbar
        settings={resolveSettings(undefined)}
        change={vi.fn()}
        reset={vi.fn()}
      />
      <div
        data-testid="canvas"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>,
  );

describe.each(["Settings", "Relationships"])("Toolbar %s popover", (name) => {
  const button = () => screen.getByRole("button", { name });

  it("toggles on the button and reflects aria-expanded", () => {
    setup();
    expect(button()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(button()).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(button());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a canvas pointer-down and on Escape", () => {
    setup();
    fireEvent.click(button());
    fireEvent.pointerDown(screen.getByTestId("canvas"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button()).toHaveFocus();
  });

  it("stays open when clicking inside", () => {
    setup();
    fireEvent.click(button());
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("Toolbar popovers together", () => {
  it("opening Relationships closes Settings", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Relationships" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
