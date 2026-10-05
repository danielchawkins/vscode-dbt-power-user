import { Dispatch, useContext } from "react";
import { DocumentationContext } from "../context";
import type { DocumentationAction } from "./documentationReducer";
import { DocumentationStateProps } from "./types";

const useDocumentationContext = (): {
  state: DocumentationStateProps;
  dispatch: Dispatch<DocumentationAction>;
} => {
  const { state, dispatch } = useContext(DocumentationContext);
  return { state, dispatch };
};

export default useDocumentationContext;
