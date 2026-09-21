import { ReactNode, useState } from "react";
import { activateClickOnKeyDown } from "../../keyboardActivation";
import classes from "./accordion.module.scss";

const Accordion = ({
  trigger,
  children,
  defaultOpen = false,
}: {
  trigger: (b: boolean) => ReactNode;
  children: (args: { close: () => void }) => ReactNode;
  defaultOpen?: boolean;
}): JSX.Element => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        className="cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((b) => !b);
        }}
        onKeyDown={(e) =>
          activateClickOnKeyDown(e, () => {
            setOpen((b) => !b);
          })
        }
      >
        {trigger(open)}
      </div>
      <div className={`${classes.accordion} ${open ? classes.open : ""}`}>
        {children({ close: () => setOpen(false) })}
      </div>
    </div>
  );
};

export default Accordion;
