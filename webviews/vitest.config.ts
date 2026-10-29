import { readFileSync } from "node:fs";
import { defineConfig, mergeConfig } from "vitest/config";
import { viteConfig } from "./vite.config";

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
      environment: "happy-dom",
      globals: false,
      // The trace run swaps the flag, since --throw-deprecation would stop it at the first warning.
      execArgv: [
        process.env.TRACE_DEPRECATIONS === "1"
          ? "--trace-deprecation"
          : "--throw-deprecation",
      ],
      setupFiles: [`${import.meta.dirname}/src/test/setup.ts`],
      // `npm test` passes --coverage, which slows the code enough to break timing assertions. Those tests read
      // FPU_V8_COVERAGE and skip only the timing check.
      env: process.argv.includes("--coverage") ? { FPU_V8_COVERAGE: "1" } : {},
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
