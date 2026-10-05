import { RefreshIcon } from "@assets/icons";
import { executeRequestInSync } from "@modules/documentationEditor/requests";
import { panelLogger } from "@modules/logger";
import { Button } from "@uicore";
import classes from "../../styles.module.css";

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
