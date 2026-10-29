import DocumentationHelpContent from "@modules/documentationEditor/components/help/DocumentationHelpContent";
import TestsHelpContent from "@modules/documentationEditor/components/help/TestsHelpContent";
import type { DrawerRef } from "@uicore";
import { Button, ButtonGroup, Drawer } from "@uicore";
import { useEffect, useRef, useState } from "react";

const Pages = {
  DOCUMENTATION: 0,
  TESTS: 1,
} as const;
type Pages = (typeof Pages)[keyof typeof Pages];

interface Props {
  onClose?: (() => void) | undefined;
}

const HelpButton = ({ onClose }: Props): React.JSX.Element => {
  const [selectedPage, setSelectedPage] = useState<Pages>(Pages.DOCUMENTATION);
  const drawerRef = useRef<DrawerRef | null>(null);

  useEffect(() => {
    drawerRef.current?.open();
  }, []);

  const handleClick = (page: Pages) => {
    setSelectedPage(page);
  };

  const openTest = () => {
    handleClick(Pages.TESTS);
  };
  return (
    <Drawer title="Help" onClose={onClose} ref={drawerRef}>
      <ButtonGroup className="mb-2">
        <Button
          color={selectedPage === Pages.DOCUMENTATION ? "primary" : "secondary"}
          onClick={() => handleClick(Pages.DOCUMENTATION)}
        >
          Documentation
        </Button>
        <Button
          color={selectedPage === Pages.TESTS ? "primary" : "secondary"}
          onClick={openTest}
        >
          Tests
        </Button>
      </ButtonGroup>
      {selectedPage === Pages.DOCUMENTATION ? (
        <DocumentationHelpContent />
      ) : null}
      {selectedPage === Pages.TESTS ? <TestsHelpContent /> : null}
    </Drawer>
  );
};

export default HelpButton;
