import { defineConfig } from "@rsbuild/core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  source: {
    entry: {
      extension: "./src/extension.ts",
    },
  },
  output: {
    target: "node",
    filename: {
      js: "[name].js",
    },
    distPath: {
      root: "dist",
    },
    // Webview panels also emit into dist/, so don't wipe it.
    cleanDistPath: false,
    sourceMap: {
      js: "source-map",
    },
    // Match the pre-rsbuild terser config (mangle: false, keep classnames/fnames)
    // so stack traces in VS Code remain actionable, while still getting dead-code
    // elimination and whitespace stripping.
    minify: {
      js: true,
      jsOptions: {
        minimizerOptions: {
          mangle: false,
          compress: {
            keep_classnames: true,
            keep_fnames: true,
          },
        },
      },
    },
  },
  resolve: {
    alias: {
      "@extension": path.resolve(ROOT, "./src/modules.ts"),
    },
    extensions: [".ts", ".js"],
  },
  performance: {
    chunkSplit: {
      strategy: "all-in-one",
    },
  },
  dev: {
    writeToDisk: true,
  },
  tools: {
    rspack: (config) => {
      config.externals = ["vscode"];

      config.node = { __dirname: "node-module", __filename: "node-module" };

      config.output = {
        ...config.output,
        libraryTarget: "module",
        chunkFormat: "module",
        devtoolModuleFilenameTemplate: "../[resource-path]",
      };

      config.experiments = {
        ...config.experiments,
        outputModule: true,
      };

      return config;
    },
  },
});
