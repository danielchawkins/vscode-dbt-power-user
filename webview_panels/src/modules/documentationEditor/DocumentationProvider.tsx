import {
  executeRequestInAsync,
  executeRequestInSync,
} from "@modules/app/requestExecutor";
import { IncomingMessageProps } from "@modules/app/types";
import { panelLogger } from "@modules/logger";
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import DocumentationEditor from "./DocumentationEditor";
import documentationSlice, {
  initialState,
  setDocBlocks,
  setIncomingDocsData,
  setMissingDocumentationMessage,
  setProject,
  updateColumnsAfterSync,
  updateCurrentDocsData,
  updateCurrentDocsTests,
  updateCurrentUnitTests,
} from "./state/documentationSlice";
import {
  DBTDocumentation,
  DBTModelTest,
  DBTUnitTest,
  DocBlock,
} from "./state/types";
import { ContextProps } from "./types";
import { isStateDirty } from "./utils";

export const DocumentationContext = createContext<ContextProps>({
  state: initialState,
  dispatch: () => null,
});

type IncomingMessageEvent = MessageEvent<
  IncomingMessageProps & {
    docs?: DBTDocumentation;
    tests?: DBTModelTest[];
    unitTests?: DBTUnitTest[];
    project?: string;
    columns?: DBTDocumentation["columns"];
    model?: string;
    docBlocks?: DocBlock[];
    name?: string;
    description?: string;
    missingDocumentationMessage?: {
      message: string;
      type: "error" | "warning";
    };
  }
>;

enum ActionState {
  CANCEL_STAY = "Stay",
  DISCARD_PROCEED = "Discard",
}

const DocumentationProvider = (): JSX.Element => {
  const [state, dispatch] = useReducer(
    documentationSlice.reducer,
    documentationSlice.getInitialState(),
  );
  const stateRef = useRef(state);

  const renderDocumentation = (event: IncomingMessageEvent) => {
    dispatch(
      setIncomingDocsData({
        docs: event.data.docs,
        tests: event.data.tests,
        unitTests: event.data.unitTests,
      }),
    );
    dispatch(setProject(event.data.project));
    dispatch(
      setMissingDocumentationMessage(event.data.missingDocumentationMessage),
    );
    dispatch(setDocBlocks(event.data.docBlocks ?? []));
  };

  const onMessage = useCallback((event: IncomingMessageEvent) => {
    const { command } = event.data;
    switch (command) {
      case "renderDocumentation": {
        const { currentDocsData } = stateRef.current;
        if (!isStateDirty(stateRef.current)) {
          renderDocumentation(event);
          break;
        }
        executeRequestInSync("showWarningMessage", {
          infoMessage: `You have unsaved changes in model: ‘${currentDocsData?.name}’. Would you
          like to discard the changes or remain in the current state?`,
          items: [ActionState.DISCARD_PROCEED, ActionState.CANCEL_STAY],
        })
          .then((action) => {
            switch (action) {
              case ActionState.DISCARD_PROCEED: {
                dispatch(updateCurrentDocsData(event.data.docs));
                dispatch(updateCurrentDocsTests(event.data.tests));
                dispatch(updateCurrentUnitTests(event.data.unitTests));
                renderDocumentation(event);
                break;
              }
              case ActionState.CANCEL_STAY: {
                break;
              }
              default:
                break;
            }
          })
          .catch((err) => {
            panelLogger.error(
              "error while showing unsaved changes dialog",
              err,
            );
          });
        break;
      }
      case "renderColumnsFromMetadataFetch":
        if (event.data.columns) {
          dispatch(
            updateColumnsAfterSync({
              columns: event.data.columns,
            }),
          );
        }
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("message", onMessage);
    // Load current editor documentation
    executeRequestInAsync("getCurrentModelDocumentation", {});

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  const values = useMemo(
    () => ({
      state,
      dispatch,
    }),
    [state, dispatch],
  );

  // hack to get latest state in onMessage
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  return (
    <DocumentationContext.Provider value={values}>
      <DocumentationEditor />
    </DocumentationContext.Provider>
  );
};

export default DocumentationProvider;
