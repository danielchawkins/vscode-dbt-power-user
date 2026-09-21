import { defineConfig, mergeConfig } from "vitest/config";
import { viteConfig } from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      globals: false,
      setupFiles: [`${import.meta.dirname}/src/test/setup.ts`],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  }),
);
