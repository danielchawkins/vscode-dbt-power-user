import { AppContext } from "@modules/app/AppProvider";
import { initialState } from "@modules/app/appSlice";
import { Themes } from "@modules/app/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CodeBlock from "./index";
import classes from "./codeblock.module.scss";

const sampleSql = "select 1 as id";
const sampleYaml = "version: 2";

const renderCodeBlock = (
  theme: Themes,
  props: React.ComponentProps<typeof CodeBlock>,
): ReturnType<typeof render> => {
  return render(
    <AppContext.Provider
      value={{ state: { ...initialState, theme }, dispatch: () => undefined }}
    >
      <CodeBlock {...props} />
    </AppContext.Provider>,
  );
};

describe("CodeBlock", () => {
  it("renders code text safely without interpreting markup", () => {
    const { container } = renderCodeBlock(Themes.Dark, {
      code: "<script>alert(1)</script>",
      language: "sql",
    });

    expect(container.querySelector("code")?.textContent).toBe(
      "<script>alert(1)</script>",
    );
    expect(document.querySelector("script")).toBeNull();
  });

  it("renders SQL with line numbers when enabled", () => {
    const { container } = renderCodeBlock(Themes.Dark, {
      code: sampleSql,
      language: "sql",
      showLineNumbers: true,
    });

    expect(container.querySelector(".linenumber")).not.toBeNull();
    expect(container.querySelector("code.language-sql")?.textContent).toContain(
      sampleSql,
    );
  });

  it("omits line numbers when disabled", () => {
    const { container } = renderCodeBlock(Themes.Dark, {
      code: sampleSql,
      language: "sql",
      showLineNumbers: false,
    });

    expect(container.querySelector(".linenumber")).toBeNull();
  });

  it("renders YAML language path", () => {
    const { container } = renderCodeBlock(Themes.Dark, {
      code: sampleYaml,
      language: "yaml",
    });

    expect(container.querySelector("code.language-yaml")?.textContent).toBe(
      sampleYaml,
    );
  });

  it("renders filename and title actions", () => {
    renderCodeBlock(Themes.Dark, {
      code: sampleYaml,
      language: "yaml",
      fileName: "schema.yml",
      titleActions: <span data-testid="title-action">copy</span>,
    });

    expect(screen.getByText("schema.yml")).toBeInTheDocument();
    expect(screen.getByTestId("title-action")).toBeInTheDocument();
  });

  it("applies a custom classname on the card", () => {
    const { container } = renderCodeBlock(Themes.Dark, {
      code: sampleSql,
      language: "sql",
      classname: "border border-primary",
    });

    const card = container.querySelector(`.${classes.codeblock}`);
    expect(card?.className).toContain("border border-primary");
  });

  it("uses dark styling context from app state", () => {
    const { container: darkContainer } = renderCodeBlock(Themes.Dark, {
      code: sampleSql,
      language: "sql",
    });
    const { container: lightContainer } = renderCodeBlock(Themes.Light, {
      code: sampleSql,
      language: "sql",
    });

    const darkStyle = darkContainer.querySelector("pre")?.getAttribute("style");
    const lightStyle = lightContainer.querySelector("pre")?.getAttribute("style");
    expect(darkStyle).toBeTruthy();
    expect(lightStyle).toBeTruthy();
    expect(darkStyle).not.toEqual(lightStyle);
  });
});
