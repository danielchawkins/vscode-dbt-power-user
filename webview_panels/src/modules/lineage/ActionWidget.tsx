import HelpButton from "./components/help/HelpButton";
import ComputeColumnLineageButton from "./ComputeColumnLineageButton";
import styles from "./lineage.module.scss";
import MissingLineageMessageComponent from "./MissingLineageMessage";
import { MissingLineageMessage } from "./types";

const ActionWidget = ({
  missingLineageMessage,
}: {
  missingLineageMessage?: MissingLineageMessage;
}): JSX.Element => {
  return (
    <div className={styles.actionWidget}>
      <MissingLineageMessageComponent
        missingLineageMessage={missingLineageMessage}
      />

      <div id="expand-container" className="al-tw-scope" />
      <div id="refs-container" className="al-tw-scope" />
      <div id="settings-container" className="al-tw-scope" />
      <ComputeColumnLineageButton />
      <HelpButton />
      <div id="reset-container" className="al-tw-scope" />
    </div>
  );
};

export default ActionWidget;
