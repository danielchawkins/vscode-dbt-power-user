import { updateCurrentDocsTests } from "@modules/documentationEditor/state/documentationReducer";
import useDocumentationContext from "@modules/documentationEditor/state/useDocumentationContext";
import { panelLogger } from "@modules/logger";
import { useState } from "react";
import { editTests, TestOperation } from "../testEdits";
import type { SaveRequest } from "../types";
import { generateHash } from "../utils";

const useTestFormSave = (): {
  handleSave: (
    data: SaveRequest,
    column: string,
    operation: TestOperation,
  ) => void;
  isSaving: boolean;
} => {
  const [isSaving, setIsSaving] = useState(false);
  const {
    state: { currentDocsData, currentDocsTests },
    dispatch,
  } = useDocumentationContext();

  const handleSave = async (
    data: SaveRequest,
    column: string,
    operation: TestOperation,
  ) => {
    if (!data.test) {
      return;
    }
    setIsSaving(true);

    // Only a created test is keyed by the hash of its request.
    const key =
      operation === TestOperation.CREATE
        ? await generateHash(JSON.stringify({ ...data, column }))
        : "";
    const testsData = editTests({
      tests: currentDocsTests ?? [],
      column,
      model: currentDocsData?.name ?? "",
      request: data,
      operation,
      key,
    });
    panelLogger.info("add/update test data", testsData);
    dispatch(updateCurrentDocsTests(testsData));
  };

  return { handleSave, isSaving };
};

export default useTestFormSave;
