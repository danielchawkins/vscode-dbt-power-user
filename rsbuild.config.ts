import { defineConfig, RsbuildPlugin } from "@rsbuild/core";
import { cpSync } from "fs";
import path from "path";

const DIST = path.resolve(__dirname, "dist");

const copyAssetsPlugin: RsbuildPlugin = {
  name: "copy-assets-plugin",
  setup(api) {
    api.onBeforeBuild(() => {
      const patterns = [
        {
          from: path.resolve(
            __dirname,
            "node_modules/@altimateai/dbt-integration/dist/node_python_bridge.py",
          ),
          to: path.join(DIST, "node_python_bridge.py"),
        },
        {
          from: path.resolve(
            __dirname,
            "node_modules/@altimateai/dbt-integration/dist/altimate_python_packages/dbt_core_integration.py",
          ),
          to: path.join(
            DIST,
            "altimate_python_packages/dbt_core_integration.py",
          ),
        },
        {
          from: path.resolve(
            __dirname,
            "node_modules/@altimateai/dbt-integration/dist/altimate_python_packages/dbt_utils.py",
          ),
          to: path.join(DIST, "altimate_python_packages/dbt_utils.py"),
        },
        {
          from: path.resolve(
            __dirname,
            "node_modules/@altimateai/dbt-integration/dist/altimate_python_packages/altimate_packages/",
          ),
          to: path.join(DIST, "altimate_python_packages/altimate_packages/"),
        },
      ];

      // These assets are runtime-required by the extension (Python bridge,
      // kernel, and altimate-dbt-integration Python packages). Abort the
      // build if any of them is missing — matches webpack's CopyPlugin
      // default (noErrorOnMissing: false) that this code replaced.
      for (const { from, to } of patterns) {
        try {
          cpSync(from, to, { recursive: true });
        } catch (error) {
          throw new Error(
            `Required asset missing: failed to copy ${from} -> ${to}: ${
              (error as Error).message
            }`,
          );
        }
      }
    });
  },
};

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
      "@extension": path.resolve(__dirname, "./src/modules.ts"),
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
      config.externals = [
        "vscode",
        "@altimateai/altimate-core",
        /^@altimateai\/altimate-core-/,
        // Ignored because we don't use them, and App Insights has try/catch
        // guarding their loading: https://github.com/microsoft/vscode-extension-telemetry/issues/41#issuecomment-598852991
        "applicationinsights-native-metrics",
        "@opentelemetry/tracing",
        "@azure/opentelemetry-instrumentation-azure-sdk",
        "@opentelemetry/instrumentation",
        "@azure/functions-core",
      ];

      config.node = { __dirname: false };

      config.output = {
        ...config.output,
        libraryTarget: "commonjs2",
        devtoolModuleFilenameTemplate: "../[resource-path]",
      };

      // Use ts-loader so inversify's decorators + emitDecoratorMetadata keep working.
      config.module = config.module || {};
      config.module.rules = (config.module.rules || []).filter((rule: any) => {
        if (rule && typeof rule === "object" && rule.test instanceof RegExp) {
          return !rule.test.test("file.ts");
        }
        return true;
      });
      config.module.rules.push({
        test: /\.ts$/,
        exclude: /(node_modules|src\/test)/,
        use: [{ loader: "ts-loader" }],
      });

      return config;
    },
  },
  plugins: [copyAssetsPlugin],
});
