import { Button } from "@uicore";
import { RefreshIcon } from "@assets/icons";
import classes from "../../styles.module.css";
import { executeRequestInSync } from "@modules/documentationEditor/requests";
import { panelLogger } from "@modules/logger";

const SyncWithDatabase = (): JSX.Element => {
  const onSyncBtnClick = () => {
    executeRequestInSync("fetchMetadataFromDatabase").catch((err) =>
      panelLogger.error("error while syncing with db", err),
    );
  };

  return (
    <Button
      color="warning"
      onClick={onSyncBtnClick}
      className={classes.syncBtn}
      icon={<RefreshIcon />}
    >
      Sync with the Database
    </Button>
  );
};

export default SyncWithDatabase;
