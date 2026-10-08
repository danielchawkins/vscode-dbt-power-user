import { describe, expect, it } from "vitest";
import {
  applyOverlay,
  resolveToolEnvironment,
  type ToolEnvironmentDeps,
} from "../../fusion/toolEnvironment";

const root = "/work/project";
const host = { PATH: "/bin", HOME: "/home/u" };

interface Fake {
  tools?: string[];
  envrc?: string;
  responses: Record<
    string,
    { stdout?: string; stderr?: string; code?: unknown }
  >;
}

function fakeDeps(fake: Fake): ToolEnvironmentDeps & {
  calls: string[];
  options: { cwd: string; timeoutMs: number }[];
} {
  const calls: string[] = [];
  const options: { cwd: string; timeoutMs: number }[] = [];
  return {
    calls,
    options,
    which: async (name) =>
      fake.tools?.includes(name) ? `/bin/${name}` : undefined,
    fileExists: (path) => path === fake.envrc,
    run: async (command, args, { cwd, timeoutMs }) => {
      const key = [command, ...args].join(" ");
      calls.push(key);
      options.push({ cwd, timeoutMs });
      const response = fake.responses[key];
      if (!response) {
        throw new Error(`unexpected command: ${key}`);
      }
      if (response.code !== undefined) {
        throw Object.assign(new Error(`Command failed: ${key}`), {
          stdout: "",
          stderr: "",
          ...response,
        });
      }
      return { stdout: response.stdout ?? "", stderr: response.stderr ?? "" };
    },
  };
}

const miseEnv = `mise env --json -C ${root}`;
const miseConfigs = `mise config ls --json -C ${root}`;
const json = (value: unknown) => ({ stdout: JSON.stringify(value) });

describe("resolveToolEnvironment", () => {
  it("uses mise when a project config is present", async () => {
    const deps = fakeDeps({
      tools: ["mise", "direnv"],
      envrc: "/work/.envrc",
      responses: {
        [miseEnv]: json({ FOO: "1" }),
        [miseConfigs]: json([
          { path: "/home/u/.config/mise/config.toml", tools: [] },
          { path: "/work/project/mise.toml", tools: ["node"] },
        ]),
      },
    });
    await expect(resolveToolEnvironment(root, host, deps)).resolves.toEqual({
      kind: "resolved",
      manager: "mise",
      overlay: { FOO: "1" },
    });
  });

  it("falls through to direnv when mise has only the global config", async () => {
    const deps = fakeDeps({
      tools: ["mise", "direnv"],
      envrc: "/work/.envrc",
      responses: {
        [miseEnv]: json({ FOO: "1" }),
        [miseConfigs]: json([
          { path: "/home/u/.config/mise/config.toml" },
          { path: "/home/u/.config/mise/conf.d/node.toml" },
          { path: "/etc/mise/conf.d/system.toml" },
        ]),
        "direnv status --json": json({ state: { foundRC: { allowed: 0 } } }),
        "direnv export json": json({ BAR: "2", GONE: null }),
      },
    });
    await expect(resolveToolEnvironment(root, host, deps)).resolves.toEqual({
      kind: "resolved",
      manager: "direnv",
      overlay: { BAR: "2", GONE: null },
    });
  });

  it("reports untrusted mise with the file to trust", async () => {
    const deps = fakeDeps({
      tools: ["mise"],
      responses: {
        [miseEnv]: {
          code: 1,
          stderr:
            "mise error Config files in /work/project/mise.toml are not trusted.",
        },
      },
    });
    await expect(
      resolveToolEnvironment(root, host, deps),
    ).resolves.toMatchObject({
      kind: "untrusted",
      manager: "mise",
      hint: "mise trust /work/project/mise.toml",
    });
  });

  it("quotes a trust path that contains spaces", async () => {
    const deps = fakeDeps({
      tools: ["mise"],
      responses: {
        [miseEnv]: {
          code: 1,
          stderr:
            "mise ERROR Config files in /work/My Projects/mise.toml are not trusted.\nTrust them with `mise trust`.",
        },
      },
    });
    await expect(
      resolveToolEnvironment(root, host, deps),
    ).resolves.toMatchObject({
      hint: "mise trust '/work/My Projects/mise.toml'",
    });
  });

  it("counts MISE_CONFIG_DIR and MISE_GLOBAL_CONFIG_FILE as global config", async () => {
    const deps = fakeDeps({
      tools: ["mise", "direnv"],
      envrc: "/work/project/.envrc",
      responses: {
        [miseEnv]: json({ FOO: "1" }),
        [miseConfigs]: json([
          { path: "/cfg/mise/conf.d/tools.toml" },
          { path: "/dotfiles/mise.toml" },
          { path: "/home/u/.config/mise.toml" },
        ]),
        "direnv status --json": json({ state: { foundRC: { allowed: 0 } } }),
        "direnv export json": json({ BAR: "2" }),
      },
    });
    const env = {
      ...host,
      MISE_CONFIG_DIR: "/cfg/mise",
      MISE_GLOBAL_CONFIG_FILE: "/dotfiles/mise.toml",
    };
    await expect(resolveToolEnvironment(root, env, deps)).resolves.toEqual({
      kind: "resolved",
      manager: "direnv",
      overlay: { BAR: "2" },
    });
  });

  it("runs every process in the root with a 5 s timeout", async () => {
    const deps = fakeDeps({
      tools: ["mise"],
      responses: {
        [miseEnv]: json({ FOO: "1" }),
        [miseConfigs]: json([{ path: "/work/project/mise.toml" }]),
      },
    });
    await resolveToolEnvironment(root, host, deps);
    expect(deps.options).toEqual([
      { cwd: root, timeoutMs: 5000 },
      { cwd: root, timeoutMs: 5000 },
    ]);
  });

  it("reports a direnv .envrc that is not allowed", async () => {
    const deps = fakeDeps({
      tools: ["direnv"],
      envrc: "/work/project/.envrc",
      responses: {
        "direnv status --json": json({ state: { foundRC: { allowed: 1 } } }),
      },
    });
    const result = await resolveToolEnvironment(root, host, deps);
    expect(result).toMatchObject({
      kind: "untrusted",
      manager: "direnv",
      hint: "direnv allow",
    });
    expect(deps.calls).not.toContain("direnv export json");
  });

  it("exports an allowed direnv environment", async () => {
    const deps = fakeDeps({
      tools: ["direnv"],
      envrc: "/work/project/.envrc",
      responses: {
        "direnv status --json": json({ state: { foundRC: { allowed: 0 } } }),
        "direnv export json": json({ BAR: "2" }),
      },
    });
    await expect(resolveToolEnvironment(root, host, deps)).resolves.toEqual({
      kind: "resolved",
      manager: "direnv",
      overlay: { BAR: "2" },
    });
  });

  it("returns none when neither manager applies", async () => {
    const deps = fakeDeps({ tools: ["direnv"], responses: {} });
    await expect(resolveToolEnvironment(root, host, deps)).resolves.toEqual({
      kind: "none",
    });
    expect(deps.calls).toEqual([]);
  });

  it("returns failed on a timeout", async () => {
    const deps = fakeDeps({
      tools: ["mise"],
      responses: { [miseEnv]: { code: "ETIMEDOUT" } },
    });
    await expect(
      resolveToolEnvironment(root, host, deps),
    ).resolves.toMatchObject({
      kind: "failed",
      manager: "mise",
      detail: expect.stringContaining("ETIMEDOUT"),
    });
  });
});

describe("applyOverlay", () => {
  it("sets variables and deletes those overlaid with null", () => {
    expect(applyOverlay({ A: "1", B: "2" }, { B: null, C: "3" })).toEqual({
      A: "1",
      C: "3",
    });
  });
});
