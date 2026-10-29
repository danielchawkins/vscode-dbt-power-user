import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PopoverWithButton } from "..";

const Pair = () => (
  <div>
    <PopoverWithButton button={<button type="button">A</button>}>
      {() => <input aria-label="a-field" />}
    </PopoverWithButton>
    <PopoverWithButton button={<button type="button">B</button>}>
      {() => <input aria-label="b-field" />}
    </PopoverWithButton>
    <div
      data-testid="canvas"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  </div>
);

describe("PopoverWithButton", () => {
  it("opens on click and closes on a second click", () => {
    render(<Pair />);
    const a = screen.getByText("A");
    expect(a).toHaveAttribute("aria-haspopup", "dialog");
    expect(a).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(a);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(a).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(a);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(a).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on a pointer-down outside, even if the target stops propagation", () => {
    render(<Pair />);
    fireEvent.click(screen.getByText("A"));
    fireEvent.pointerDown(screen.getByTestId("canvas"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and returns focus to the button", () => {
    render(<Pair />);
    fireEvent.click(screen.getByText("A"));
    expect(screen.getByLabelText("a-field")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("A")).toHaveFocus();
  });

  it("returns focus to the control that opened the popover, not the first button", () => {
    render(
      <PopoverWithButton
        button={
          <span>
            <button type="button">first</button>
            <button type="button">second</button>
          </span>
        }
      >
        {() => <input aria-label="f" />}
      </PopoverWithButton>,
    );
    fireEvent.click(screen.getByText("second"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("second")).toHaveFocus();
  });

  it("closes the other popover when one opens", () => {
    render(<Pair />);
    fireEvent.click(screen.getByText("A"));
    fireEvent.click(screen.getByText("B"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByLabelText("b-field")).toBeInTheDocument();
    expect(screen.getByText("A")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("B")).toHaveAttribute("aria-expanded", "true");
  });

  it("stays open for pointer-downs and clicks inside the popover", () => {
    render(<Pair />);
    fireEvent.click(screen.getByText("A"));
    const field = screen.getByLabelText("a-field");
    fireEvent.pointerDown(field);
    fireEvent.click(field);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
