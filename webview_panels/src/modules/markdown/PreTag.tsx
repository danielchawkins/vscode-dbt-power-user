import { CheckedIcon, FilesIcon } from "@assets/icons";
import { panelLogger } from "@modules/logger";
import { IconButton } from "@uicore";
import { DetailedHTMLProps, HTMLAttributes, useState } from "react";
import classes from "./markdown.module.css";

const PreTag = ({
  children,
  text,
  ...rest
}: DetailedHTMLProps<HTMLAttributes<HTMLPreElement>, HTMLPreElement> & {
  text?: string;
}): JSX.Element => {
  const [isCopied, setIsCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      panelLogger.error("Unable to copy to clipboard", error);
      setCopyFailed(true);
      setTimeout(() => {
        setCopyFailed(false);
      }, 3000);
      return;
    }
    setIsCopied(true);
    setTimeout(() => {
      setIsCopied(false);
    }, 3000);
  };

  return (
    <div className={classes.pre}>
      {text ? (
        <div className="code__icons">
          <IconButton
            title={
              copyFailed
                ? "Copy failed"
                : isCopied
                  ? "Copied to clipboard"
                  : "Copy to clipboard"
            }
            onClick={() => void copy(text)}
          >
            {!isCopied ? <FilesIcon /> : <CheckedIcon />}
          </IconButton>
        </div>
      ) : null}
      <pre {...rest}>{children}</pre>
    </div>
  );
};

export default PreTag;
