import type { documentationEditor } from "@fusion-power-user/webview-contract";
import {
  executeRequestInAsync,
  executeRequestInSync,
} from "@modules/documentationEditor/requests";
import { panelLogger } from "@modules/logger";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { DocumentationContext } from "./context";
import DocumentationEditor from "./DocumentationEditor";
import { ProposalsContext } from "./proposals/ProposalsContext";
import {
  cleared,
  initialProposalsState,
  proposalsReducer,
  received,
} from "./proposals/proposalsReducer";
import {
  documentationReducer,
  initialState,
  rendered,
  updateCurrentDocsData,
  updateCurrentDocsTests,
  updateCurrentUnitTests,
} from "./state/documentationReducer";
import { incomingDecision, type RenderMessage } from "./state/incomingDocs";
import useDraftSync from "./state/useDraftSync";
import { fromHostDocumentation } from "./utils";

type HostMessage = documentationEditor.HostMessage;

const ActionState = {
  CANCEL_STAY: "Stay",
  DISCARD_PROCEED: "Discard",
} as const;
type ActionState = (typeof ActionState)[keyof typeof ActionState];

const DocumentationProvider = (): React.JSX.Element => {
  const [state, dispatch] = useReducer(documentationReducer, initialState);
  const stateRef = useRef(state);
  const [proposalsState, proposalsDispatch] = useReducer(
    proposalsReducer,
    initialProposalsState,
  );

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
        switch (incomingDecision(stateRef.current, message)) {
          case "render":
            dispatch(rendered(message));
            break;
          case "renderWithoutDraft":
            dispatch(rendered({ ...message, draft: undefined }));
            break;
          case "ask":
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
                    dispatch(rendered(message));
                    break;
                  }
                  case ActionState.CANCEL_STAY:
                  case undefined: {
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
        break;
      }
      // The app listener settles responses; this panel shows no error state.
      case "response":
      case "renderError":
        break;
      // Column proposals for another model are dropped: they describe a file that is no longer open.
      case "renderColumnProposals": {
        if (
          event.data.payload.model ===
          stateRef.current.currentDocsData?.filePath
        ) {
          proposalsDispatch(received(event.data.payload));
        }
        break;
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("message", onMessage);
    // Load current editor documentation
    executeRequestInAsync("getCurrentModelDocumentation");

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [onMessage]);

  const values = useMemo(
    () => ({
      state,
      dispatch,
    }),
    [state, dispatch],
  );

  const proposalValues = useMemo(
    () => ({
      state: proposalsState,
      dispatch: proposalsDispatch,
    }),
    [proposalsState, proposalsDispatch],
  );

  // hack to get latest state in onMessage
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Proposals describe the model they were computed for, so a different model drops them.
  const filePath = state.currentDocsData?.filePath;
  useEffect(() => {
    proposalsDispatch(cleared());
  }, [filePath]);

  useDraftSync(state);

  return (
    <DocumentationContext value={values}>
      <ProposalsContext value={proposalValues}>
        <DocumentationEditor />
      </ProposalsContext>
    </DocumentationContext>
  );
};

export default DocumentationProvider;
