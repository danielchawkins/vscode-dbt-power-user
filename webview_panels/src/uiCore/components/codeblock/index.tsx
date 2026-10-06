import { Themes } from "@modules/app/types";
import useAppContext from "@modules/app/useAppContext";
import { ReactNode } from "react";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import vs from "react-syntax-highlighter/dist/esm/styles/prism/vs";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";
import { Card, CardBody, CardTitle } from "../primitives";
import classes from "./codeblock.module.css";

type CodeBlockLanguage = "sql" | "yaml" | "markdown" | "json" | "javascript";

interface Props {
  code: string;
  language: CodeBlockLanguage;
  fileName?: string | undefined;
  showLineNumbers?: boolean | undefined;
  titleActions?: ReactNode | undefined;
  classname?: string | undefined;
}

SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("javascript", javascript);

const CodeBlockComponent = ({
  code,
  language,
  fileName,
  showLineNumbers,
  titleActions,
  classname,
}: Props): JSX.Element => {
  const {
    state: { theme },
  } = useAppContext();
  const isDark = theme === Themes.Dark;

  return (
    <div className={classes.wrapper}>
      <Card className={`${classes.codeblock} ${classname ?? ""}`}>
        {fileName ? (
          <CardTitle className={classes.title}>
            {fileName} {titleActions}
          </CardTitle>
        ) : null}
        <CardBody>
          <SyntaxHighlighter
            showLineNumbers={showLineNumbers}
            language={language}
            style={isDark ? vscDarkPlus : vs}
          >
            {code}
          </SyntaxHighlighter>
        </CardBody>
      </Card>
    </div>
  );
};

export default CodeBlockComponent;
