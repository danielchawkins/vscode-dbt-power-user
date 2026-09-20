import { FeedbackIcon } from "@assets/icons";
import { vscode } from "@modules/vscode";
import { Button } from "@uicore";

const FeedbackButton = ({
  url,
  onClose,
  buttonProps,
}: {
  url: string;
  onClose?: () => void;
  buttonProps?: Parameters<typeof Button>[0];
}): JSX.Element => {
  const handleFeedbackClick = () => {
    onClose?.();
    vscode.postMessage({
      command: "openURL",
      url,
    });
  };
  return (
    <Button
      outline
      onClick={handleFeedbackClick}
      icon={<FeedbackIcon />}
      {...buttonProps}
    >
      Feedback
    </Button>
  );
};

export default FeedbackButton;
