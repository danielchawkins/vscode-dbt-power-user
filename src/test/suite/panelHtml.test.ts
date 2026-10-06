import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { Uri, Webview } from "vscode";
import {
  contentSecurityPolicy,
  entryAssets,
  panelEntries,
  panelHtml,
  panelWebviewOptions,
  ViteManifest,
} from "../../webview/panelHtml";

const extensionUri = Uri.file("/ext");
const webview = {
  cspSource: "https://res.example",
  asWebviewUri: (uri: Uri) => `https://res.example${uri.path}`,
} as unknown as Webview;

const manifest: ViteManifest = {
  "src/entries/lineage.tsx": {
    file: "assets/lineage.js",
    name: "lineage",
    isEntry: true,
    imports: ["_shared.js"],
    css: ["assets/lineage.css"],
  },
  "src/entries/queryResults.tsx": {
    file: "assets/queryResults.js",
    name: "queryResults",
    isEntry: true,
    imports: ["_shared.js"],
    css: ["assets/queryResults.css"],
  },
  "_shared.js": {
    file: "assets/chunk-shared.js",
    imports: ["_shared.js"],
    css: ["assets/shared.css"],
  },
};

const directives = (policy: string) =>
  new Map(
    policy.split("; ").map((d) => {
      const [name, ...sources] = d.split(" ");
      return [name, sources];
    }),
  );

describe("contentSecurityPolicy", () => {
  it("denies by default and grants a panel without allowances only scripts, styles, fonts and images", () => {
    const policy = directives(contentSecurityPolicy("SRC", "N", {}));
    expect([...policy.keys()]).toEqual([
      "default-src",
      "script-src",
      "style-src",
      "font-src",
      "img-src",
    ]);
    expect(policy.get("default-src")).toEqual(["'none'"]);
    expect(policy.get("script-src")).toEqual(["'nonce-N'", "SRC"]);
  });

  it("allows inline styles only to a panel that asks for them", () => {
    expect(contentSecurityPolicy("SRC", "N", {})).not.toContain(
      "'unsafe-inline'",
    );
    expect(contentSecurityPolicy("SRC", "N", { inlineStyles: true })).toContain(
      "style-src SRC 'unsafe-inline'",
    );
  });

  it("never allows eval or remote origins", () => {
    const policy = contentSecurityPolicy("SRC", "N", {
      wasm: true,
      connect: true,
      blobWorkers: true,
    });
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/https:(?!\/\/)|\*/);
  });

  it("adds only the allowances a panel declares", () => {
    const policy = directives(
      contentSecurityPolicy("SRC", "N", {
        wasm: true,
        connect: true,
        blobWorkers: true,
      }),
    );
    expect(policy.get("script-src")).toContain("'wasm-unsafe-eval'");
    expect(policy.get("connect-src")).toEqual(["SRC"]);
    expect(policy.get("worker-src")).toEqual(["blob:"]);
  });
});

describe("panelEntries", () => {
  it("names exactly the files in webview_panels/src/entries", () => {
    const dir = path.resolve(__dirname, "../../../webview_panels/src/entries");
    const files = readdirSync(dir)
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => path.basename(file, ".tsx"));
    expect([...panelEntries].sort()).toEqual(files.sort());
  });
});

describe("entryAssets", () => {
  it("returns the entry script and the stylesheets of every chunk it imports, once each", () => {
    expect(entryAssets(manifest, "lineage")).toEqual({
      script: "assets/lineage.js",
      styles: ["assets/shared.css", "assets/lineage.css"],
    });
  });

  it("fails for an entry the build did not emit", () => {
    expect(() => entryAssets(manifest, "documentationEditor")).toThrow(
      /documentationEditor/,
    );
  });
});

describe("panelHtml", () => {
  const render = () =>
    panelHtml(webview, extensionUri, { entry: "lineage", csp: {} }, manifest);

  it("loads only the panel's own entry and stylesheets", () => {
    const html = render();
    const dist = "https://res.example/ext/webview_panels/dist";
    expect(html).toContain(`src="${dist}/assets/lineage.js"`);
    expect(html).toContain(`href="${dist}/assets/shared.css"`);
    expect(html).toContain(`href="${dist}/assets/lineage.css"`);
    expect(html).toContain(`href="${dist}/assets/codicons/codicon.css"`);
    expect(html).not.toContain("queryResults");
    expect(html).toContain('data-entry="lineage"');
  });

  it("nonces its only script", () => {
    const html = render();
    const nonce = /'nonce-([0-9a-f]+)'/.exec(html)?.[1];
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(html.match(/<script[^>]*>/g)).toEqual([
      expect.stringContaining(`nonce="${nonce}"`),
    ]);
  });

  it("uses a fresh nonce per render", () => {
    expect(render()).not.toBe(render());
  });
});

describe("panelWebviewOptions", () => {
  it("limits local resources to the built webview assets", () => {
    expect(panelWebviewOptions(extensionUri)).toEqual({
      enableScripts: true,
      localResourceRoots: [
        expect.objectContaining({ path: "/ext/webview_panels/dist/assets" }),
      ],
    });
  });
});

describe("panelHtml manifest cache", () => {
  it("re-reads the built manifest when its modification time changes", () => {
    const root = mkdtempSync(path.join(tmpdir(), "panel-html-"));
    const assets = path.join(root, "webview_panels", "dist", "assets");
    mkdirSync(assets, { recursive: true });
    const file = path.join(assets, "manifest.json");
    const write = (script: string, seconds: number) => {
      const built: ViteManifest = {
        "src/entries/lineage.tsx": {
          file: script,
          name: "lineage",
          isEntry: true,
        },
      };
      writeFileSync(file, JSON.stringify(built));
      utimesSync(file, seconds, seconds);
    };
    const render = () =>
      panelHtml(webview, Uri.file(root), {
        entry: "lineage",
        csp: {},
      });
    try {
      write("assets/one.js", 1_000);
      expect(render()).toContain("assets/one.js");
      write("assets/two.js", 2_000);
      expect(render()).toContain("assets/two.js");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
