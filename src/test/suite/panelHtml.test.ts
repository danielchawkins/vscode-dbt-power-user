import { describe, expect, it } from "vitest";
import { Uri, Webview } from "vscode";
import {
  contentSecurityPolicy,
  panelHtml,
  panelWebviewOptions,
} from "../../webview/panelHtml";

const extensionUri = Uri.file("/ext");
const webview = {
  cspSource: "https://res.example",
  asWebviewUri: (uri: Uri) => `https://res.example${uri.path}`,
} as unknown as Webview;

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

describe("panelHtml", () => {
  it("nonces every script and loads the bundle from the asset root", () => {
    const html = panelHtml(webview, extensionUri, {
      viewPath: "/lineage",
      csp: {},
    });
    const nonce = /'nonce-([0-9a-f]+)'/.exec(html)?.[1];
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
    expect(html).toContain(
      'src="https://res.example/ext/webview_panels/dist/assets/main.js"',
    );
  });

  it("uses a fresh nonce per render", () => {
    const page = { viewPath: "/lineage", csp: {} };
    expect(panelHtml(webview, extensionUri, page)).not.toBe(
      panelHtml(webview, extensionUri, page),
    );
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
