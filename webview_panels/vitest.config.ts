import { readFileSync } from "node:fs";
import { defineConfig, mergeConfig } from "vitest/config";
import { viteConfig } from "./vite.config.ts";

const ceilings = JSON.parse(
  readFileSync(
    `${import.meta.dirname}/../scripts/quality/ceilings.json`,
    "utf8",
  ),
) as Record<string, Record<string, number>>;

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: false,
      setupFiles: [`${import.meta.dirname}/src/test/setup.ts`],
      include: ["src/**/*.test.{ts,tsx}"],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/test/**", "src/**/*.test.{ts,tsx}"],
        reporter: ["text-summary"],
        thresholds: ceilings["coverage.webview"],
      },
    },
  }),
);
