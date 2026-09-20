import { executeRequestInSync } from "@modules/app/requestExecutor";
import { panelLogger } from "@modules/logger";
import { Stack } from "@uicore";
import { Alert, Button } from "antd";
import { useState } from "react";
import classes from "./onboarding.module.scss";

interface InstallDbtStepProps {
  onComplete?: () => void;
  onSkip?: () => void;
}

type InstallState = "idle" | "installing" | "complete" | "error";

const InstallDbtStep = ({
  onComplete,
  onSkip,
}: InstallDbtStepProps): JSX.Element => {
  const [installState, setInstallState] = useState<InstallState>("idle");
  const [error, setError] = useState<string | undefined>();

  const handleInstall = async () => {
    try {
      setError(undefined);
      setInstallState("installing");

      await executeRequestInSync("installDbt", {});

      setInstallState("complete");

      // Call onComplete callback if provided
      if (onComplete) {
        setTimeout(onComplete, 1500);
      }
    } catch (err) {
      panelLogger.error("Error installing dbt", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to install dbt. Check the terminal for details.",
      );
      setInstallState("error");
    }
  };

  const handleSkip = () => {
    if (onSkip) {
      onSkip();
    }
  };

  const isInstalling = installState === "installing";
  const isComplete = installState === "complete";

  return (
    <div className={classes.installDbtContainer}>
      <div className={classes.installDbtInfo}>
        <p>
          Install dbt Fusion to enable all features of Fusion Power User.
        </p>
      </div>

      {error && (
        <Alert
          message="Installation Error"
          description={error}
          type="error"
          showIcon
          closable
          onClose={() => setError(undefined)}
          className={classes.alertMessage}
        />
      )}

      {isComplete && (
        <Alert
          message="Installation successful!"
          description="dbt Fusion has been installed successfully."
          type="success"
          showIcon
          className={classes.alertMessage}
        />
      )}

      <Stack direction="row" className={classes.installDbtActions}>
        <Button
          size="large"
          onClick={handleSkip}
          disabled={isInstalling || isComplete}
        >
          Skip this step
        </Button>
        <Button
          type="primary"
          size="large"
          onClick={handleInstall}
          disabled={isInstalling || isComplete}
          loading={isInstalling}
        >
          {isComplete
            ? "Installed"
            : isInstalling
              ? "Installing..."
              : "Install dbt Fusion"}
        </Button>
      </Stack>

      <div className={classes.helpText}>
        <p>
          Need help choosing?{" "}
          <a
            href="https://docs.myaltimate.com/setup/reqdConfig/"
            target="_blank"
            rel="noopener noreferrer"
          >
            View integration documentation
          </a>
        </p>
      </div>
    </div>
  );
};

export default InstallDbtStep;
