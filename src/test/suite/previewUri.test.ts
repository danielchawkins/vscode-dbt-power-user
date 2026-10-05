import { describe, expect, it, vi } from "vitest";
import { URI } from "vscode-uri";
import {
  activeModelUri,
  modelUriOf,
  PREVIEW_SCHEME,
  previewUriFor,
} from "../../projects/previewUri";

vi.mock("vscode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vscode")>()),
  Uri: (await import("vscode-uri")).URI,
}));

const model = (path: string) => URI.file(path);
const parse = (value: string) => URI.parse(value);

describe("previewUriFor / modelUriOf", () => {
  it.each([
    "/workspace/jaffle/models/orders.sql",
    "/workspace/my project/models/stg orders.sql",
    "/workspace/jaffle/models/überstunden_日本.sql",
    "/workspace/a#b/models/c#d.sql",
    "/workspace/a?b/models/c?d.sql",
    "/workspace/100%/models/50%25.sql",
  ])("round-trips %s", (path) => {
    const preview = previewUriFor(model(path));
    const reparsed = parse(preview.toString());
    expect(modelUriOf(preview)?.toString()).toBe(model(path).toString());
    expect(modelUriOf(reparsed)?.toString()).toBe(model(path).toString());
    expect(modelUriOf(reparsed)?.fsPath).toBe(path);
  });

  it("puts the model basename at the root so no filename pattern matches", () => {
    const preview = previewUriFor(
      model("/workspace/jaffle/models/marts/orders.sql"),
    );
    expect(preview.scheme).toBe(PREVIEW_SCHEME);
    expect(preview.path).toBe("/orders.sql");
  });

  it.each([
    ["/workspace/models/orders.py", "/orders.sql"],
    ["/workspace/models/orders", "/orders.sql"],
    ["/workspace/models/orders.v2.sql", "/orders.v2.sql"],
  ])("always ends the preview path of %s in .sql", (modelPath, previewPath) => {
    expect(previewUriFor(model(modelPath)).path).toBe(previewPath);
  });

  it("keeps a non-file model scheme", () => {
    const untitled = parse("untitled:Untitled-1");
    expect(modelUriOf(previewUriFor(untitled))?.toString()).toBe(
      "untitled:Untitled-1",
    );
  });

  it("returns undefined for URIs that are not compiled previews", () => {
    expect(modelUriOf(model("/workspace/models/orders.sql"))).toBeUndefined();
    expect(modelUriOf(parse(`${PREVIEW_SCHEME}:/orders.sql`))).toBeUndefined();
  });

  it("activeModelUri resolves previews and passes other URIs through", () => {
    const orders = model("/workspace/models/orders.sql");
    expect(activeModelUri(previewUriFor(orders)).toString()).toBe(
      orders.toString(),
    );
    expect(activeModelUri(orders)).toBe(orders);
  });
});
