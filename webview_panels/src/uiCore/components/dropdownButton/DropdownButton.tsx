import { ChevronDownIcon } from "@assets/icons";
import { Button, ButtonProps } from "../button/Button";
import IconButton from "../iconButton/IconButton";
import Stack from "../stack/Stack";
import classes from "./styles.module.css";

/** `aria-haspopup`/`aria-expanded` go to the chevron, which is what opens the popup. */
interface Props extends ButtonProps {
  onToggleClick: () => void;
}

const DropdownButton = ({
  onToggleClick,
  "aria-haspopup": ariaHasPopup,
  "aria-expanded": ariaExpanded,
  ...props
}: Props): React.JSX.Element => (
  <Stack className={classes.dropdownButton}>
    <Button color="primary" {...props}>
      {props.children}
    </Button>
    <IconButton
      onClick={onToggleClick}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      color={props.color ?? "primary"}
    >
      <ChevronDownIcon />
    </IconButton>
  </Stack>
);

export default DropdownButton;
