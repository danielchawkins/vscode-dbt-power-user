import { DocumentationContext } from "@modules/documentationEditor/context";
import {
  initialState,
  updateCurrentDocsTests,
} from "@modules/documentationEditor/state/documentationReducer";
import { DbtGenericTests } from "@modules/documentationEditor/state/types";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TestOperation } from "../testEdits";
import useTestFormSave from "./useTestFormSave";

const existing = {
  column_name: "amount",
  key: "k0",
  test_metadata: {
    name: DbtGenericTests.NOT_NULL,
    kwargs: { column_name: "amount", model: "orders" },
  },
};

describe("useTestFormSave", () => {
  it("sets isSaving and dispatches the edited tests for a request that names a test", async () => {
    const dispatch = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        DocumentationContext,
        {
          value: {
            state: {
              ...initialState,
              currentDocsData: {
                name: "orders",
                description: "",
                columns: [],
                generated: false,
                filePath: "/models/orders.sql",
              },
              currentDocsTests: [existing],
            },
            dispatch,
          },
        },
        children,
      );
    const { result } = renderHook(() => useTestFormSave(), { wrapper });
    expect(result.current.isSaving).toBe(false);

    await act(async () => {
      await result.current.handleSave(
        { test: DbtGenericTests.UNIQUE },
        "id",
        TestOperation.CREATE,
      );
    });

    expect(result.current.isSaving).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      updateCurrentDocsTests([
        existing,
        {
          column_name: "id",
          key: expect.any(String),
          test_metadata: {
            name: "unique",
            kwargs: { column_name: "id", model: "orders" },
          },
        },
      ]),
    );
  });
});
