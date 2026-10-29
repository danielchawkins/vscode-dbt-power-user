import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import classes from "./codeblock.module.css";
import CodeBlock from "./index";

const sampleSql = "select 1 as id";
const sampleYaml = "version: 2";

const renderCodeBlock = (
  theme: "dark" | "light",
  props: Omit<React.ComponentProps<typeof CodeBlock>, "theme">,
): ReturnType<typeof render> => {
  return render(<CodeBlock {...props} theme={theme} />);
};

describe("CodeBlock", () => {
  it("renders code text safely without interpreting markup", () => {
    const { container } = renderCodeBlock("dark", {
      code: "<script>alert(1)</script>",
      language: "sql",
    });

    expect(container.querySelector("code")?.textContent).toBe(
      "<script>alert(1)</script>",
    );
    expect(document.querySelector("script")).toBeNull();
  });

  it("renders SQL with line numbers when enabled", () => {
    const { container } = renderCodeBlock("dark", {
      code: sampleSql,
      language: "sql",
      showLineNumbers: true,
    });

    expect(container.querySelector(`.${classes.lineNumber}`)).not.toBeNull();
    expect(container.querySelector("code.language-sql")?.textContent).toContain(
      sampleSql,
    );
  });

  it("omits line numbers when disabled", () => {
    const { container } = renderCodeBlock("dark", {
      code: sampleSql,
      language: "sql",
      showLineNumbers: false,
    });

    expect(container.querySelector(`.${classes.lineNumber}`)).toBeNull();
  });

  it("renders YAML language path", () => {
    const { container } = renderCodeBlock("dark", {
      code: sampleYaml,
      language: "yaml",
    });

    expect(container.querySelector("code.language-yaml")?.textContent).toBe(
      sampleYaml,
    );
  });

  it("renders filename and title actions", () => {
    renderCodeBlock("dark", {
      code: sampleYaml,
      language: "yaml",
      fileName: "schema.yml",
      titleActions: <span data-testid="title-action">copy</span>,
    });

    expect(screen.getByText("schema.yml")).toBeInTheDocument();
    expect(screen.getByTestId("title-action")).toBeInTheDocument();
  });

  it("applies a custom classname on the card", () => {
    const { container } = renderCodeBlock("dark", {
      code: sampleSql,
      language: "sql",
      classname: "border border-primary",
    });

    const card = container.querySelector(`.${classes.codeblock}`);
    expect(card?.className).toContain("border border-primary");
  });

  it("styles dark and light themes differently from the theme prop", () => {
    const { container: darkContainer } = renderCodeBlock("dark", {
      code: sampleSql,
      language: "sql",
    });
    const { container: lightContainer } = renderCodeBlock("light", {
      code: sampleSql,
      language: "sql",
    });

    const darkStyle = darkContainer.querySelector("pre")?.getAttribute("style");
    const lightStyle = lightContainer
      .querySelector("pre")
      ?.getAttribute("style");
    expect(darkStyle).toBeTruthy();
    expect(lightStyle).toBeTruthy();
    expect(darkStyle).not.toEqual(lightStyle);
  });
});
