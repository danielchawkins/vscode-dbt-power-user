import { Themes } from "@modules/app/types";
import useAppContext from "@modules/app/useAppContext";
import { ReactNode, useMemo } from "react";
import { Card, CardBody, CardTitle } from "../primitives";
import classes from "./codeblock.module.css";
import { CodeBlockLanguage, highlightLines } from "./prism";

interface Props {
  code: string;
  language: CodeBlockLanguage;
  fileName?: string | undefined;
  showLineNumbers?: boolean | undefined;
  titleActions?: ReactNode | undefined;
  classname?: string | undefined;
}

const CodeBlockComponent = ({
  code,
  language,
  fileName,
  showLineNumbers,
  titleActions,
  classname,
}: Props): React.JSX.Element => {
  const {
    state: { theme },
  } = useAppContext();
  const isDark = theme === Themes.Dark;
  const lines = useMemo(() => highlightLines(code, language), [code, language]);

  return (
    <div className={classes.wrapper}>
      <Card className={`${classes.codeblock} ${classname ?? ""}`}>
        {fileName ? (
          <CardTitle className={classes.title}>
            {fileName} {titleActions}
          </CardTitle>
        ) : null}
        <CardBody>
          <pre
            className={isDark ? classes.dark : classes.light}
            style={{ color: isDark ? "#d4d4d4" : "#393a34" }}
          >
            <code className={`language-${language}`}>
              {lines.map((line, lineIndex) => (
                // Lines have no identity beyond their position.
                // eslint-disable-next-line @eslint-react/no-array-index-key
                <div key={lineIndex}>
                  {showLineNumbers ? (
                    <span className={classes.lineNumber}>{lineIndex + 1}</span>
                  ) : null}
                  {line.map((span, spanIndex) => (
                    // eslint-disable-next-line @eslint-react/no-array-index-key
                    <span key={spanIndex} className={span.className}>
                      {span.text}
                    </span>
                  ))}
                </div>
              ))}
            </code>
          </pre>
        </CardBody>
      </Card>
    </div>
  );
};

export default CodeBlockComponent;
