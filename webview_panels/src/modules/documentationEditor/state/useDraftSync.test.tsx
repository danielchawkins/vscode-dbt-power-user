import { act, render } from "@testing-library/react";
import { useReducer } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { getVsCodeApiMock } from "../../../test/setup";
import {
  documentationReducer,
  initialState,
  setIncomingDocsData,
  updateCurrentDocsData,
} from "./documentationReducer";
import { DBTDocumentation, Source } from "./types";
import useDraftSync from "./useDraftSync";

const orders: DBTDocumentation = {
  name: "orders",
  description: "saved",
  columns: [
    { name: "id", description: "", generated: false, source: Source.YAML },
  ],
  generated: false,
  filePath: "/models/orders.sql",
};

let dispatchRef: React.Dispatch<Parameters<typeof documentationReducer>[1]>;

const Harness = (): null => {
  const [state, dispatch] = useReducer(documentationReducer, initialState);
  dispatchRef = dispatch;
  useDraftSync(state);
  return null;
};

const drafts = () =>
  getVsCodeApiMock()
    .postMessage.mock.calls.map(
      ([message]) => message as Record<string, unknown>,
    )
    .filter((message) => message.command === "saveDraft");

describe("useDraftSync", () => {
  beforeEach(() => {
    render(<Harness />);
    act(() => dispatchRef(setIncomingDocsData({ docs: orders })));
    getVsCodeApiMock().postMessage.mockClear();
  });

  it("sends nothing while the editor is clean", () => {
    expect(drafts()).toEqual([]);
  });

  it("sends the edited documentation while the editor is dirty", () => {
    act(() =>
      dispatchRef(
        updateCurrentDocsData({ name: "orders", description: "edit" }),
      ),
    );

    expect(drafts().slice(-1)[0]).toMatchObject({
      model: "/models/orders.sql",
      draft: { docs: { description: "edit" } },
    });
  });

  it("clears the host's draft once the edits are saved or reverted", () => {
    act(() =>
      dispatchRef(
        updateCurrentDocsData({ name: "orders", description: "edit" }),
      ),
    );
    act(() =>
      dispatchRef(
        updateCurrentDocsData({ name: "orders", description: "saved" }),
      ),
    );

    const last = drafts().slice(-1)[0];
    expect(last).toMatchObject({ model: "/models/orders.sql" });
    expect(last?.draft).toBeUndefined();
  });
});
