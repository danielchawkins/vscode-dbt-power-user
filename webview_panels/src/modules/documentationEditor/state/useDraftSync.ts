import { useEffect, useRef } from "react";
import { executeRequestInAsync } from "../requests";
import { isStateDirty } from "../utils";
import { DocumentationStateProps } from "./types";

/**
 * Keeps the host's copy of the editor's unsaved draft current: the edited documentation and tests while the
 * editor is dirty, and nothing for a model once its edits are saved, reverted or discarded.
 */
const useDraftSync = (state: DocumentationStateProps): void => {
  const { currentDocsData, currentDocsTests } = state;
  const model = currentDocsData?.filePath;
  const dirty = isStateDirty(state);
  const heldRef = useRef<string>();

  useEffect(() => {
    const held = heldRef.current;
    if (held !== undefined && (held !== model || !dirty)) {
      heldRef.current = undefined;
      executeRequestInAsync("saveDraft", { model: held });
    }
    if (dirty && model !== undefined && currentDocsData) {
      heldRef.current = model;
      executeRequestInAsync("saveDraft", {
        model,
        draft: { docs: currentDocsData, tests: currentDocsTests },
      });
    }
  }, [model, dirty, currentDocsData, currentDocsTests]);
};

export default useDraftSync;
