import { act, render } from "@testing-library/react";
import { useReducer, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVsCodeApiMock } from "../../../test/setup";
import { DocumentationContext } from "../DocumentationProvider";
import {
  documentationReducer,
  initialState,
  setIncomingDocsData,
  setPublication,
} from "./documentationReducer";
import { Source } from "./types";
import useDocumentationViewState from "./useDocumentationViewState";

const docs = {
  name: "orders",
  description: "",
  columns: [
    { name: "id", description: "", generated: false, source: Source.YAML },
  ],
  generated: false,
  filePath: "/models/orders.sql",
  uniqueId: "model.p.orders",
};

let dispatchRef: React.Dispatch<Parameters<typeof documentationReducer>[1]>;
let stateRef: ReturnType<typeof documentationReducer>;

const Probe = (): JSX.Element => {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  useDocumentationViewState(scroller);
  return <div ref={setScroller} data-testid="scroller" />;
};

const Harness = (): JSX.Element => {
  const [state, dispatch] = useReducer(documentationReducer, initialState);
  dispatchRef = dispatch;
  stateRef = state;
  return (
    <DocumentationContext.Provider value={{ state, dispatch }}>
      <Probe />
    </DocumentationContext.Provider>
  );
};

const renderModel = (publication: string) =>
  act(() => {
    dispatchRef(setPublication(publication));
    dispatchRef(setIncomingDocsData({ docs }));
  });

describe("useDocumentationViewState", () => {
  const scrollTo = vi.fn();
  beforeEach(() => {
    scrollTo.mockClear();
    HTMLElement.prototype.scrollTo = scrollTo;
  });
  afterEach(() => {
    getVsCodeApiMock().getState.mockReturnValue(undefined);
  });

  it("restores search and scroll saved for the same model and publication", () => {
    getVsCodeApiMock().getState.mockReturnValue({
      panel: "documentationEditor",
      publication: "s:4",
      model: "model.p.orders",
      scrollTop: 80,
      searchQuery: "id",
    } as never);
    render(<Harness />);

    renderModel("s:4");

    expect(stateRef.searchQuery).toBe("id");
    expect(scrollTo).toHaveBeenCalledWith({ top: 80 });
  });

  it("revalidates: a state saved at another publication is not restored", () => {
    getVsCodeApiMock().getState.mockReturnValue({
      panel: "documentationEditor",
      publication: "s:3",
      model: "model.p.orders",
      scrollTop: 80,
      searchQuery: "id",
    } as never);
    render(<Harness />);

    renderModel("s:4");

    expect(stateRef.searchQuery).toBe("");
    expect(scrollTo).not.toHaveBeenCalled();
    expect(getVsCodeApiMock().setState).toHaveBeenLastCalledWith({
      panel: "documentationEditor",
      publication: "s:4",
      model: "model.p.orders",
      scrollTop: 0,
      searchQuery: "",
    });
  });
});
