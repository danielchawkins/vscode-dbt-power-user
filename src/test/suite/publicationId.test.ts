import { describe, expect, it, vi } from "vitest";

const loadManifestModule = async () => {
  vi.resetModules();
  return import("../../projects/manifest");
};

describe("publicationId", () => {
  it("differs between publications of one session", async () => {
    const { publicationId } = await loadManifestModule();
    expect(publicationId({ publicationEpoch: 1 })).not.toBe(
      publicationId({ publicationEpoch: 2 }),
    );
    expect(publicationId({ publicationEpoch: 1 })).toBe(
      publicationId({ publicationEpoch: 1 }),
    );
    expect(publicationId(undefined)).toBeUndefined();
  });

  it("never matches the same epoch from an earlier extension-host session", async () => {
    const earlier = (await loadManifestModule()).publicationId({
      publicationEpoch: 1,
    });
    const later = (await loadManifestModule()).publicationId({
      publicationEpoch: 1,
    });
    expect(later).not.toBe(earlier);
  });
});
