import { executeRequestInAsync } from "./requests";
import { Alert, Button } from "@uicore";
import type { PanelNotice } from "@fusion-power-user/webview-contract";

const MissingLineageMessageComponent = ({
  missingLineageMessage,
}: {
  missingLineageMessage?: PanelNotice;
}): JSX.Element | null => {
  const openProblemsTab = () => {
    return executeRequestInAsync("openProblemsTab");
  };

  if (!missingLineageMessage) {
    return null;
  }
  return (
    <Alert color="warning" className="p-2 mb-0">
      {missingLineageMessage.message}
      {missingLineageMessage.type === "error" ? (
        <>
          <Button
            color="link"
            className={"pt-0 pb-0"}
            style={{ marginTop: -5 }}
            onClick={openProblemsTab}
          >
            Click here
          </Button>{" "}
          to view Problems tab
        </>
      ) : (
        ""
      )}
    </Alert>
  );
};

export default MissingLineageMessageComponent;
