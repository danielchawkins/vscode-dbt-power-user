import { describe, expect, it } from "vitest";
import {
  commandPrefixForProject,
  FUSION_LSP_COMMANDS,
  languageClientIdForProject,
  prefixedCommand,
} from "../../fusion/fusionClient";
import { makeProject } from "../fusionClientHarness";

describe("fusionLanguageClient helpers", () => {
  it("applies the same prefix for advertised commands and requests", () => {
    const prefix = commandPrefixForProject(makeProject());
    expect(prefix.endsWith(":")).toBe(true);
    expect(prefix.startsWith("fusionPowerUser:")).toBe(true);

    for (const command of Object.values(FUSION_LSP_COMMANDS)) {
      expect(prefixedCommand(prefix, command)).toBe(`${prefix}${command}`);
    }
  });

  it("derives a unique language client id from the project root digest", () => {
    const general = makeProject("/workspace/general");
    const sox = makeProject("/workspace/sox");
    const generalAgain = makeProject("/workspace/general");

    expect(languageClientIdForProject(general)).toMatch(/^fusion-lsp-/);
    expect(languageClientIdForProject(general)).toBe(
      languageClientIdForProject(generalAgain),
    );
    expect(languageClientIdForProject(general)).not.toBe(
      languageClientIdForProject(sox),
    );
  });
});
