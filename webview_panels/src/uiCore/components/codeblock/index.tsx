import { Themes } from "@modules/app/types";
import useAppContext from "@modules/app/useAppContext";
import { ReactNode } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import tomorrow from "react-syntax-highlighter/dist/esm/styles/prism/tomorrow";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";
import { Card, CardBody, CardTitle } from "reactstrap";
import classes from "./codeblock.module.scss";

type CodeBlockLanguage = "sql" | "yaml" | "markdown" | "json" | "javascript";

interface Props {
  code: string;
  language: CodeBlockLanguage;
  fileName?: string;
  showLineNumbers?: boolean;
  titleActions?: ReactNode;
  classname?: string;
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
          <CardTitle className="d-flex justify-content-between">
            {fileName} {titleActions}
          </CardTitle>
        ) : null}
        <CardBody>
          <SyntaxHighlighter
            showLineNumbers={showLineNumbers}
            language={language}
            style={isDark ? vscDarkPlus : tomorrow}
          >
            {code}
          </SyntaxHighlighter>
        </CardBody>
      </Card>
    </div>
  );
};

export default CodeBlockComponent;
