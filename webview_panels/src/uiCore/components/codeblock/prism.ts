import type { Token, TokenStream } from "prismjs";
import Prism from "./prismGlobal";
import "./prismGrammars";

export type CodeBlockLanguage =
  "sql" | "yaml" | "markdown" | "json" | "javascript";

/** A run of text with the token classes that apply to it. */
export interface Span {
  text: string;
  className: string;
}

const spansOf = (
  stream: TokenStream,
  inherited: string,
  lines: Span[][],
): void => {
  if (typeof stream === "string") {
    const parts = stream.split("\n");
    parts.forEach((text, index) => {
      if (index > 0) {
        lines.push([]);
      }
      if (text) {
        lines[lines.length - 1]?.push({ text, className: inherited });
      }
    });
    return;
  }
  if (Array.isArray(stream)) {
    for (const part of stream) {
      spansOf(part, inherited, lines);
    }
    return;
  }
  const token: Token = stream;
  const alias = Array.isArray(token.alias)
    ? token.alias.join(" ")
    : (token.alias ?? "");
  const className = `${inherited} token ${token.type} ${alias}`.trim();
  spansOf(token.content, className, lines);
};

/** The source split into lines of classed text runs. */
export const highlightLines = (
  code: string,
  language: CodeBlockLanguage,
): Span[][] => {
  const grammar = Prism.languages[language];
  const lines: Span[][] = [[]];
  spansOf(grammar ? Prism.tokenize(code, grammar) : code, "", lines);
  return lines;
};
