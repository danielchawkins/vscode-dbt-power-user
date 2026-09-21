import {
  DBTDetection,
  DBTFusionCommandProjectDetection,
  DBTFusionCommandProjectIntegration,
  DBTProjectDetection,
  DBTProjectIntegrationAdapter,
  DeferConfig,
} from "@altimateai/dbt-integration";
import { describe, expect, it, jest } from "@jest/globals";
import { Memento } from "vscode";
import { FusionVersionDetection } from "../../fusion/fusionVersionDetection";

// Stub env and extensions before importing the container, which constructs
// Python services.
import * as vscodeMock from "../mock/vscode";
const vscodeMockAny = vscodeMock as Record<string, unknown>;
Object.assign(vscodeMockAny.env as Record<string, unknown>, {
  appName: "vscode-test",
  machineId: "test-machine",
  sessionId: "test-session",
});
const sharedWindow = vscodeMockAny.window as Record<string, unknown>;
sharedWindow.createOutputChannel = jest.fn(() => ({
  append: jest.fn(),
  appendLine: jest.fn(),
  clear: jest.fn(),
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  trace: jest.fn(),
  replace: jest.fn(),
  name: "Log - dbt",
  logLevel: 1,
  onDidChangeLogLevel: () => ({ dispose: () => {} }),
}));
Object.assign(vscodeMockAny.extensions as Record<string, unknown>, {
  getExtension: jest.fn(() => ({
    isActive: true,
    activate: () => Promise.resolve(),
    exports: {
      settings: {
        getExecutionDetails: () => ({ execCommand: ["python"] }),
        onDidChangeExecutionDetails: () => ({ dispose: () => {} }),
      },
      environment: {
        getEnvironmentPaths: async () => [],
        getEnvironmentDetails: async () => ({ executable: { uri: undefined } }),
      },
    },
  })),
});

import { container } from "../../inversify.config";

describe("Fusion-only integration wiring", () => {
  it("uses Fusion detection", () => {
    const factory = container.get<
      (globalState: Memento | undefined) => DBTDetection
    >("Factory<DBTDetection>");

    expect(factory(undefined)).toBeInstanceOf(FusionVersionDetection);
  });

  it("uses Fusion project detection", () => {
    const factory = container.get<() => DBTProjectDetection>(
      "Factory<DBTProjectDetection>",
    );

    expect(factory()).toBeInstanceOf(DBTFusionCommandProjectDetection);
  });

  it("uses the Fusion project integration", () => {
    type AdapterFactory = (
      projectRoot: string,
      deferConfig: DeferConfig | undefined,
    ) => DBTProjectIntegrationAdapter;

    const factory = container.get<AdapterFactory>(
      "Factory<DBTProjectIntegrationAdapter>",
    );
    const adapter = factory("/tmp/project", undefined);

    expect(adapter.getCurrentProjectIntegration()).toBeInstanceOf(
      DBTFusionCommandProjectIntegration,
    );
  });
});
