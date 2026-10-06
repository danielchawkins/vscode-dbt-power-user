import { HelpIcon } from "@assets/icons";
import { Button, Stack } from "@uicore";
import { useState } from "react";
import HelpButton from "./HelpButton";

const CommonActionButtons = (): JSX.Element => {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <Stack className="align-items-center text-nowrap">
      <Button
        outline
        title="Help"
        icon={<HelpIcon style={{ height: 16 }} />}
        onClick={() => setShowHelp(true)}
      />
      {showHelp ? <HelpButton onClose={() => setShowHelp(false)} /> : null}
    </Stack>
  );
};

export default CommonActionButtons;
