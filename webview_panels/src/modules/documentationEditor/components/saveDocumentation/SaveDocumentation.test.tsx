import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useReducer } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@modules/documentationEditor/requests", () => ({
  executeRequestInSync: vi.fn().mockResolvedValue({ saved: true }),
  executeRequestInAsync: vi.fn(),
}));

import { executeRequestInSync } from "@modules/documentationEditor/requests";
import { DocumentationContext } from "../../context";
import {
  documentationReducer,
  initialState,
} from "../../state/documentationReducer";
import { DBTDocumentation, Source } from "../../state/types";
import SaveDocumentation from "./SaveDocumentation";

const model = (over: Partial<DBTDocumentation> = {}): DBTDocumentation => ({
  name: "orders",
  description: "saved",
  columns: [
    { name: "id", description: "", generated: false, source: Source.YAML },
  ],
  generated: false,
  filePath: "/models/orders.sql",
  ...over,
});

const Harness = ({
  current,
  incoming,
}: {
  current: DBTDocumentation;
  incoming: DBTDocumentation;
}): React.JSX.Element => {
  const [state, dispatch] = useReducer(documentationReducer, {
    ...initialState,
    incomingDocsData: { docs: incoming },
    currentDocsData: current,
  });
  return (
    <DocumentationContext.Provider value={{ state, dispatch }}>
      <SaveDocumentation />
    </DocumentationContext.Provider>
  );
};

describe("SaveDocumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while the documentation is unchanged", () => {
    render(<Harness current={model()} incoming={model()} />);
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("saves a changed model that has a schema file with that path", async () => {
    render(
      <Harness
        current={model({ description: "edited", patchPath: "/models/s.yml" })}
        incoming={model({ patchPath: "/models/s.yml" })}
      />,
    );
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(executeRequestInSync).toHaveBeenCalledWith(
        "saveDocumentation",
        expect.objectContaining({ patchPath: "/models/s.yml" }),
      );
    });
  });

  it("opens the path popover from the chevron even when a schema file exists", () => {
    render(
      <Harness
        current={model({ description: "edited", patchPath: "/models/s.yml" })}
        incoming={model({ patchPath: "/models/s.yml" })}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const [, chevron] = screen.getAllByRole("button");
    fireEvent.click(chevron!);
    expect(screen.getByRole("dialog")).toHaveTextContent("/models/s.yml");
    expect(executeRequestInSync).not.toHaveBeenCalled();
  });

  it("toggles the popover from the chevron, which carries the aria state", () => {
    render(
      <Harness
        current={model({ description: "edited", patchPath: "/models/s.yml" })}
        incoming={model({ patchPath: "/models/s.yml" })}
      />,
    );
    const [save, chevron] = screen.getAllByRole("button");
    expect(save).not.toHaveAttribute("aria-expanded");
    expect(chevron).toHaveAttribute("aria-haspopup", "dialog");
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(chevron!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(chevron!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  it("returns focus to the chevron on Escape", () => {
    render(
      <Harness
        current={model({ description: "edited", patchPath: "/models/s.yml" })}
        incoming={model({ patchPath: "/models/s.yml" })}
      />,
    );
    const [, chevron] = screen.getAllByRole("button");
    fireEvent.click(chevron!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(chevron).toHaveFocus();
  });

  it("saves with an empty patch path when the model has no schema file yet", async () => {
    render(
      <Harness current={model({ description: "edited" })} incoming={model()} />,
    );
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(await screen.findByText("New file"));

    await waitFor(() => {
      expect(executeRequestInSync).toHaveBeenCalledWith(
        "saveDocumentation",
        expect.objectContaining({ patchPath: "", dialogType: "New file" }),
      );
    });
  });
});
