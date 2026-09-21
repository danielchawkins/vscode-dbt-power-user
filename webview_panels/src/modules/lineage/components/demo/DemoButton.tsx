import { CloseIcon, PlayCircleIcon } from "@assets/icons";
import { Demo } from "@modules/lineage/Demo";
import { useEffect, useState } from "react";
import { Modal, Button, activateClickOnKeyDown } from "@uicore";
import styles from "../../lineage.module.scss";

const DemoButton = (): JSX.Element => {
  const [showDemoButton, setShowDemoButton] = useState(true);
  const [showDemoModal, setShowDemoModal] = useState(false);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setShowDemoButton(false);
    }, 10000);
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <>
      <Modal
        isOpen={showDemoModal}
        close={() => setShowDemoModal(false)}
        fullscreen
        className={styles.demoModal}
      >
        <Demo />
        <div
          className="close-btn"
          role="button"
          tabIndex={0}
          onClick={() => setShowDemoModal(false)}
          onKeyDown={(e) =>
            activateClickOnKeyDown(e, () => setShowDemoModal(false))
          }
        >
          <CloseIcon />
        </div>
      </Modal>
      {showDemoButton ? (
        <Button
          color="primary"
          className="d-flex gap-sm align-items-center"
          onClick={(e) => {
            e.stopPropagation();
            setShowDemoModal((b) => !b);
          }}
        >
          Quick demo of Column Lineage
          <PlayCircleIcon />
        </Button>
      ) : null}
    </>
  );
};

export default DemoButton;
