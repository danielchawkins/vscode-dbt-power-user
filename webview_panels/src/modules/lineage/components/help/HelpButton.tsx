import { HelpIcon } from "@assets/icons";
import { Drawer, DrawerRef } from "@uicore";
import { useRef } from "react";
import HelpContent from "./HelpContent";

const HelpButton = (): JSX.Element => {
  const drawerRef = useRef<DrawerRef>(null);

  return (
    <>
      <button type="button" onClick={() => drawerRef.current?.open()}>
        <HelpIcon /> Help
      </button>
      <Drawer ref={drawerRef} title="Help">
        <HelpContent />
      </Drawer>
    </>
  );
};

export default HelpButton;
