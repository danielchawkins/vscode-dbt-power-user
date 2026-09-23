import { Button, Stack } from "@uicore";
import HelpButton from "./HelpButton";
import { HelpIcon } from "@assets/icons";
import { useState } from "react";

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
      {showHelp ? (
        <HelpButton onClose={() => setShowHelp(false)} />
      ) : null}
    </Stack>
  );
};

export default CommonActionButtons;
