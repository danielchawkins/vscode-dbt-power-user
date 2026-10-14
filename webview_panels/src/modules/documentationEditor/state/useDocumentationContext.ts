import type { Dispatch } from "react";
import { use } from "react";
import { DocumentationContext } from "../context";
import type { DocumentationAction } from "./documentationReducer";
import type { DocumentationStateProps } from "./types";

const useDocumentationContext = (): {
  state: DocumentationStateProps;
  dispatch: Dispatch<DocumentationAction>;
} => {
  const { state, dispatch } = use(DocumentationContext);
  return { state, dispatch };
};

export default useDocumentationContext;
