import {
  AltimateHttpClient,
  DBTDetection,
  DBTFusionCommandProjectIntegration,
  DbtIntegrationClient,
  DeferConfig,
} from "@altimateai/dbt-integration";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Memento } from "vscode";
import { DBTPowerUserExtension } from "../../dbtPowerUserExtension";
import { FusionVersionDetection } from "../../fusion/fusionVersionDetection";
import { FusionStatus } from "../../lsp/fusionStatus";

// Stub env and extensions before importing the container, which constructs
// Python services.
import * as vscodeMock from "../mock/vscode";
import { createMockLogOutputChannel } from "../mock/vscode";
const vscodeMockAny = vscodeMock as Record<string, unknown>;
Object.assign(vscodeMockAny.env as Record<string, unknown>, {
  appName: "vscode-test",
  machineId: "test-machine",
  sessionId: "test-session",
});
const sharedWindow = vscodeMockAny.window as Record<string, unknown>;
sharedWindow.createStatusBarItem = jest.fn(() => ({
  text: "",
  tooltip: undefined,
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn(),
}));
sharedWindow.createOutputChannel = jest.fn(
  (name?: string, _options?: { log?: boolean }) =>
    createMockLogOutputChannel(name),
);
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

import { FusionProjectIntegration } from "../../dbt_client/fusionProjectIntegration";

import { container } from "../../inversify.config";

describe("Fusion-only integration wiring", () => {
  const disposables: Array<{ dispose: () => void }> = [];

  afterEach(() => {
    while (disposables.length) {
      disposables.pop()?.dispose();
    }
  });

  it("uses Fusion detection", () => {
    const factory = container.get<
      (globalState: Memento | undefined) => DBTDetection
    >("Factory<DBTDetection>");

    expect(factory(undefined)).toBeInstanceOf(FusionVersionDetection);
  });

  it("does not bind Factory<DBTProjectDetection>", () => {
    expect(() => container.get("Factory<DBTProjectDetection>")).toThrow();
  });

  it("does not bind unsupported integration factories", () => {
    expect(container.isBound("Factory<DBTCoreProjectIntegration>")).toBe(false);
    expect(container.isBound("Factory<DBTCloudProjectIntegration>")).toBe(
      false,
    );
    expect(container.isBound("Factory<DBTCoreCommandProjectIntegration>")).toBe(
      false,
    );
  });

  it("does not bind hosted HTTP clients", () => {
    expect(container.isBound(AltimateHttpClient)).toBe(false);
    expect(container.isBound(DbtIntegrationClient)).toBe(false);
  });

  it("binds FusionStatus for the Fusion LSP status surface", () => {
    expect(container.isBound(FusionStatus)).toBe(true);
    const fusionStatus = container.get(FusionStatus);
    disposables.push(fusionStatus);
    expect(fusionStatus).toBeInstanceOf(FusionStatus);
  });

  it("resolves DBTPowerUserExtension with FusionStatus on the injection path", () => {
    expect(container.isBound(DBTPowerUserExtension)).toBe(true);
    const extension = container.get(DBTPowerUserExtension);
    disposables.push(extension);
    expect(extension).toBeInstanceOf(DBTPowerUserExtension);
  });

  it("uses the Fusion project integration", () => {
    type IntegrationFactory = (
      projectRoot: string,
      deferConfig: DeferConfig | undefined,
    ) => FusionProjectIntegration;

    const factory = container.get<IntegrationFactory>(
      "Factory<FusionProjectIntegration>",
    );
    const integration = factory("/tmp/project", undefined);

    expect(integration).toBeInstanceOf(FusionProjectIntegration);
    expect(integration.getCurrentProjectIntegration()).toBeInstanceOf(
      DBTFusionCommandProjectIntegration,
    );
  });
});
