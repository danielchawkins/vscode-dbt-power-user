import { SettingsIcon } from "@assets/icons";
import { AppContext } from "@modules/app/AppProvider";
import { initialState } from "@modules/app/appSlice";
import { Themes } from "@modules/app/types";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReactNode, useEffect } from "react";
import { CodeBlock, Container, IconButton } from "..";

const meta = {
  title: "UiToolKit/CodeBlock",
  component: CodeBlock,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof CodeBlock>;

export default meta;

type Story = StoryObj<typeof CodeBlock>;

const sampleSql = `select
  customer_id,
  sum(amount) as total_amount
from {{ ref('stg_orders') }}
group by 1`;

const sampleYaml = `version: 2
models:
  - name: stg_orders
    columns:
      - name: order_id
        tests:
          - unique
          - not_null`;

const longSql = `select very_long_column_name_that_should_wrap_instead_of_overflowing_horizontally, another_extremely_long_identifier_for_line_wrapping from {{ ref('some_model_with_a_very_long_name') }} where status = 'active'`;

const ThemeWrapper = ({
  theme,
  children,
}: {
  theme: Themes;
  children: ReactNode;
}): JSX.Element => {
  useEffect(() => {
    const priorClasses = [...document.body.classList];
    const bodyClass =
      theme === Themes.Light ? "vscode-light" : "vscode-dark";
    const otherClass =
      theme === Themes.Light ? "vscode-dark" : "vscode-light";
    document.body.classList.remove(otherClass);
    document.body.classList.add(bodyClass);
    return () => {
      document.body.className = "";
      for (const cls of priorClasses) {
        document.body.classList.add(cls);
      }
    };
  });

  return (
    <AppContext.Provider
      value={{ state: { ...initialState, theme }, dispatch: () => undefined }}
    >
      {children}
    </AppContext.Provider>
  );
};

const StoryFrame = ({ children }: { children: ReactNode }): JSX.Element => (
  <Container style={{ background: "var(--background--base)", maxWidth: 640 }}>
    {children}
  </Container>
);

export const SqlWithLineNumbers: Story = {
  render: () => (
    <StoryFrame>
      <CodeBlock code={sampleSql} language="sql" showLineNumbers />
    </StoryFrame>
  ),
};

export const YamlWithFilename: Story = {
  render: () => (
    <StoryFrame>
      <CodeBlock
        code={sampleYaml}
        language="yaml"
        fileName="schema.yml"
        showLineNumbers
        titleActions={
          <IconButton title="Settings">
            <SettingsIcon />
          </IconButton>
        }
      />
    </StoryFrame>
  ),
};

export const WithoutLineNumbers: Story = {
  render: () => (
    <StoryFrame>
      <CodeBlock code={sampleSql} language="sql" />
    </StoryFrame>
  ),
};

export const WithClassname: Story = {
  render: () => (
    <StoryFrame>
      <CodeBlock
        code={sampleYaml}
        language="yaml"
        classname="border border-primary"
        fileName="schema.yml"
      />
    </StoryFrame>
  ),
};

export const LongLineWrapping: Story = {
  render: () => (
    <StoryFrame>
      <CodeBlock code={longSql} language="sql" showLineNumbers />
    </StoryFrame>
  ),
};

export const LightTheme: Story = {
  render: () => (
    <ThemeWrapper theme={Themes.Light}>
      <StoryFrame>
        <CodeBlock
          code={sampleSql}
          language="sql"
          fileName="query.sql"
          showLineNumbers
        />
      </StoryFrame>
    </ThemeWrapper>
  ),
};

export const DarkTheme: Story = {
  render: () => (
    <ThemeWrapper theme={Themes.Dark}>
      <StoryFrame>
        <CodeBlock
          code={sampleYaml}
          language="yaml"
          fileName="schema.yml"
          showLineNumbers
        />
      </StoryFrame>
    </ThemeWrapper>
  ),
};
