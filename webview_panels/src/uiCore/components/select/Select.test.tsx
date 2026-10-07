import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MultiSelect, Select } from "./index";

const options = [
  { label: "A", value: "a" },
  { label: "B", value: "b" },
];

describe("Select", () => {
  it("reports the chosen value", () => {
    const onChange = vi.fn();
    render(<Select options={options} value={undefined} onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });

    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("MultiSelect", () => {
  it("reports every selected value", () => {
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={["a"]} onChange={onChange} />);
    const listbox = screen.getByRole("listbox") as HTMLSelectElement;

    (listbox.options[1] as HTMLOptionElement).selected = true;
    fireEvent.change(listbox);

    expect(onChange).toHaveBeenCalledWith(["a", "b"]);
  });
});
