import type { PanelNotice } from "@fusion-power-user/webview-contract";
import { Alert, Button } from "@uicore";
import { executeRequestInAsync } from "./requests";

const MissingLineageMessageComponent = ({
  missingLineageMessage,
}: {
  missingLineageMessage?: PanelNotice | undefined;
}): React.JSX.Element | null => {
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
      {(missingLineageMessage.actions ?? []).map(({ title, action }) => (
        <Button
          key={action}
          color="link"
          className="pt-0 pb-0"
          onClick={() => executeRequestInAsync("runNoticeAction", { action })}
        >
          {title}
        </Button>
      ))}
    </Alert>
  );
};

export default MissingLineageMessageComponent;
