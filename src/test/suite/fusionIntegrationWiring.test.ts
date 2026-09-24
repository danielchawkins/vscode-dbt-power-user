import {
  AltimateHttpClient,
  DbtIntegrationClient,
  DeferConfig,
} from "@altimateai/dbt-integration";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { DBTPowerUserExtension } from "../../dbtPowerUserExtension";
import { FusionStatus } from "../../lsp/fusionStatus";

import { FusionProjectIntegration } from "../../dbt_client/fusionProjectIntegration";
import { ConfiguredFusionExecutableResolver } from "../../fusion/fusionExecutable";
import { esmDirname } from "../esmDirname";
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

import { container } from "../../inversify.config";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const srcRoot = path.join(repositoryRoot, "src");
const forbiddenProductionSymbols = [
  "DBTClient",
  "FusionVersionDetection",
  "Factory<DBTDetection>",
  "DBTInstallationVerificationEvent",
];

function collectProductionSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      if (entry === "test" || entry === "node_modules") {
        continue;
      }
      files.push(...collectProductionSources(entryPath));
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

describe("Fusion-only integration wiring", () => {
  const disposables: Array<{ dispose: () => void }> = [];

  afterEach(() => {
    while (disposables.length) {
      disposables.pop()?.dispose();
    }
  });

  it("does not reference global detection symbols in production code", () => {
    const offenders: string[] = [];
    for (const filePath of collectProductionSources(srcRoot)) {
      const content = readFileSync(filePath, "utf8");
      for (const symbol of forbiddenProductionSymbols) {
        if (content.includes(symbol)) {
          offenders.push(
            `${path.relative(repositoryRoot, filePath)}:${symbol}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
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

  it("binds one shared Fusion executable resolver for LSP and CLI", () => {
    expect(container.isBound(ConfiguredFusionExecutableResolver)).toBe(true);
    const resolver = container.get(ConfiguredFusionExecutableResolver);
    expect(resolver).toBeInstanceOf(ConfiguredFusionExecutableResolver);
    expect(container.isBound("RuntimePythonEnvironment")).toBe(false);
    expect(
      container.isBound("Factory<DBTFusionCommandProjectIntegration>"),
    ).toBe(false);
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
    expect(() => integration.getCurrentProjectIntegration()).toThrow(
      /not initialized/,
    );
  });
});
