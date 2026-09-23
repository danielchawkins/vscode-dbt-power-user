import { Button, PopoverWithButton, Stack } from "@uicore";
import HelpButton from "./HelpButton";
import { HelpIcon, MoreIcon } from "@assets/icons";
import { useState } from "react";

enum SelectedAction {
  HELP,
}
const CommonActionButtons = (): JSX.Element => {
  const [action, setAction] = useState<SelectedAction | undefined>();

  return (
    <Stack className="align-items-center text-nowrap">
      <PopoverWithButton
        width="auto"
        button={<Button outline title="More actions" icon={<MoreIcon />} />}
        popoverProps={{
          placement: "bottom",
          hideArrow: true,
        }}
      >
        {({ close }) => (
          <Stack direction="column">
            <Button
              outline
              className="w-100 text-start"
              onClick={() => {
                close();
                setAction(SelectedAction.HELP);
              }}
            >
              <HelpIcon style={{ height: 16 }} /> Help
            </Button>
          </Stack>
        )}
      </PopoverWithButton>

      {action === SelectedAction.HELP ? (
        <HelpButton onClose={() => setAction(undefined)} />
      ) : null}
    </Stack>
  );
};

export default CommonActionButtons;
