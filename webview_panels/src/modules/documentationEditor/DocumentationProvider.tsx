import type { documentationEditor } from "@fusion-power-user/webview-contract";
import type { MessageOf } from "@modules/app/requestExecutor";
import {
  executeRequestInAsync,
  executeRequestInSync,
} from "@modules/documentationEditor/requests";
import { panelLogger } from "@modules/logger";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { DocumentationContext } from "./context";
import DocumentationEditor from "./DocumentationEditor";
import {
  documentationReducer,
  initialState,
  setDocBlocks,
  setIncomingDocsData,
  setMissingDocumentationMessage,
  setProject,
  setPublication,
  updateColumnsAfterSync,
  updateCurrentDocsData,
  updateCurrentDocsTests,
  updateCurrentUnitTests,
} from "./state/documentationReducer";
import { DBTDocumentation, DBTModelTest, DBTUnitTest } from "./state/types";
import useDraftSync from "./state/useDraftSync";
import {
  fromFetchedColumns,
  fromHostDocumentation,
  isStateDirty,
} from "./utils";

type HostMessage = documentationEditor.HostMessage;
/** `renderDocumentation` with `docs` mapped by `fromHostDocumentation`; the test types are the contract's own. */
type RenderMessage = Omit<
  MessageOf<HostMessage, "renderDocumentation">,
  "docs" | "tests" | "unitTests" | "draft"
> & {
  docs?: DBTDocumentation;
  tests?: DBTModelTest[];
  unitTests?: DBTUnitTest[];
  draft?: { docs: DBTDocumentation; tests?: DBTModelTest[] };
};

enum ActionState {
  CANCEL_STAY = "Stay",
  DISCARD_PROCEED = "Discard",
}

const DocumentationProvider = (): JSX.Element => {
  const [state, dispatch] = useReducer(documentationReducer, initialState);
  const stateRef = useRef(state);

  const renderDocumentation = (message: RenderMessage) => {
    dispatch(
      setIncomingDocsData({
        docs: message.docs,
        tests: message.tests,
        unitTests: message.unitTests,
      }),
    );
    dispatch(setProject(message.project));
    dispatch(
      setMissingDocumentationMessage(message.missingDocumentationMessage),
    );
    dispatch(setDocBlocks(message.docBlocks));
    dispatch(setPublication(message.publication));
    if (message.draft) {
      dispatch(updateCurrentDocsData(message.draft.docs));
      dispatch(updateCurrentDocsTests(message.draft.tests));
    }
  };

  const onMessage = useCallback((event: MessageEvent<HostMessage>) => {
    switch (event.data.command) {
      case "renderDocumentation": {
        const message: RenderMessage = {
          ...event.data,
          docs: fromHostDocumentation(event.data.docs),
          draft: event.data.draft && {
            docs: fromHostDocumentation(event.data.draft.docs)!,
            tests: event.data.draft.tests,
          },
        };
        const { currentDocsData } = stateRef.current;
        if (!isStateDirty(stateRef.current)) {
          renderDocumentation(message);
          break;
        }
        // The page's own edits are newer than the draft the host holds for the same model.
        if (currentDocsData?.filePath === message.draft?.docs.filePath) {
          renderDocumentation({ ...message, draft: undefined });
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
                dispatch(updateCurrentDocsData(message.docs));
                dispatch(updateCurrentDocsTests(message.tests));
                dispatch(updateCurrentUnitTests(message.unitTests));
                renderDocumentation(message);
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
              columns: fromFetchedColumns(event.data.columns),
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
    executeRequestInAsync("getCurrentModelDocumentation");

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

  useDraftSync(state);

  return (
    <DocumentationContext.Provider value={values}>
      <DocumentationEditor />
    </DocumentationContext.Provider>
  );
};

export default DocumentationProvider;
