import type { DocumentationAction } from "./state/documentationReducer";
import type { DocumentationStateProps } from "./state/types";

export interface ContextProps {
  state: DocumentationStateProps;
  dispatch: React.Dispatch<DocumentationAction>;
}
