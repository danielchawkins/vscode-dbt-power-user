import { HelpIcon } from "@assets/icons";
import { Drawer, DrawerRef } from "@uicore";
import { useRef } from "react";
import styles from "../../lineageGraph.module.css";
import HelpContent from "./HelpContent";

const HelpButton = (): React.JSX.Element => {
  const drawerRef = useRef<DrawerRef>(null);

  return (
    <>
      <button
        type="button"
        title="Help"
        onClick={() => drawerRef.current?.open()}
      >
        <HelpIcon />
        <span className={styles.buttonLabel}>Help</span>
      </button>
      <Drawer ref={drawerRef} title="Help">
        <HelpContent />
      </Drawer>
    </>
  );
};

export default HelpButton;
