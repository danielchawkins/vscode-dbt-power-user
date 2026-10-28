import type { ReactNode } from "react";
import { useMemo } from "react";
import { Card, CardBody, CardTitle } from "../primitives";
import classes from "./codeblock.module.css";
import type { CodeBlockLanguage } from "./prism";
import { highlightLines } from "./prism";

/** The VS Code colour theme the block is styled for; the caller passes its app theme. */
type CodeBlockTheme = "dark" | "light";

interface Props {
  code: string;
  language: CodeBlockLanguage;
  theme: CodeBlockTheme;
  fileName?: string | undefined;
  showLineNumbers?: boolean | undefined;
  titleActions?: ReactNode | undefined;
  classname?: string | undefined;
}

const CodeBlockComponent = ({
  code,
  language,
  theme,
  fileName,
  showLineNumbers,
  titleActions,
  classname,
}: Props): React.JSX.Element => {
  const isDark = theme === "dark";
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
                // oxlint-disable-next-line react/no-array-index-key
                <div key={lineIndex}>
                  {showLineNumbers ? (
                    <span className={classes.lineNumber}>{lineIndex + 1}</span>
                  ) : null}
                  {line.map((span, spanIndex) => (
                    // oxlint-disable-next-line react/no-array-index-key
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
