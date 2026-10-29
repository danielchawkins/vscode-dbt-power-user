import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import ChipInput from "./ChipInput";

const Harness = ({ onSubmit }: { onSubmit: () => void }): React.JSX.Element => {
  const [values, setValues] = useState<string[]>([]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <ChipInput values={values} onChange={setValues} placeholder="value" />
    </form>
  );
};

describe("ChipInput", () => {
  it("does not submit the form when Enter is pressed on an empty input", () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText("value");

    const notPrevented = fireEvent.keyDown(input, { key: "Enter" });

    expect(notPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("adds a chip on Enter and removes it with its button", () => {
    render(<Harness onSubmit={vi.fn()} />);
    const input = screen.getByPlaceholderText("value");

    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("a")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Remove a"));
    expect(screen.queryByText("a")).toBeNull();
  });
});
