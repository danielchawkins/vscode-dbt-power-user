import { ErrorBoundary } from "react-error-boundary";
import { ReactNode, useId, useState } from "react";
import { Tooltip as ReactStrapTooltip, TooltipProps } from "reactstrap";

interface Props {
  children: ReactNode;
  title?: ReactNode;
  id?: string;
  className?: string;
  placement?: TooltipProps["placement"];
  /** Set to false when tooltip content is interactive (e.g. contains links). Keeps tooltip open while hovering over it. */
  autohide?: boolean;
}
const Tooltip = (props: Props): JSX.Element => {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const toggle = () => setTooltipOpen(!tooltipOpen);
  const generatedId = useId();
  const tooltipId = (props.id ?? `tooltip-${generatedId}`).replace(
    /[^\w-]/g,
    "-",
  );

  return (
    <ErrorBoundary fallback={<span id={tooltipId}>{props.children}</span>}>
      <span id={tooltipId}>{props.children}</span>
      {props.title ? (
        <ReactStrapTooltip
          isOpen={tooltipOpen}
          target={tooltipId}
          toggle={toggle}
          className={props.className}
          placement={props.placement ?? "auto"}
          autohide={props.autohide ?? true}
        >
          {props.title}
        </ReactStrapTooltip>
      ) : null}
    </ErrorBoundary>
  );
};

export default Tooltip;
