import { createRequire } from "node:module";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const require = createRequire(import.meta.url);

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: ["@storybook/addon-links", "@storybook/addon-docs"],
  staticDirs: ["../src/assets"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  typescript: {
    reactDocgen: false,
  },
  core: {
    builder: "@storybook/builder-vite",
  },
  docs: {
    autodocs: "tag",
  },
  viteFinal(viteConfig) {
    if (viteConfig.resolve?.alias) {
      viteConfig.resolve.alias["@vscodeApi"] = require.resolve(
        "./__mocks__/vscode.ts",
      );

      viteConfig.resolve.alias["crypto"] = require.resolve(
        "./__mocks__/crypto.ts",
      );
    }
    return mergeConfig(viteConfig, {
      optimizeDeps: {
        include: ["storybook-dark-mode"],
      },
    });
  },
};
export default config;
