import type { DocumentationAction } from "./state/documentationReducer";
import { DocumentationStateProps } from "./state/types";

export interface ContextProps {
  state: DocumentationStateProps;
  dispatch: React.Dispatch<DocumentationAction>;
}
