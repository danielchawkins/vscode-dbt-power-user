import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ControlId } from "./controlCoverage";
import { collectControls, expectControlsCovered } from "./controlCoverage";

describe("control coverage helpers", () => {
  it.each(["codicon-gear"])(
    "collectControls throws on a button without an accessible name (%s)",
    (icon) => {
      const { container } = render(
        <div>
          <button type="button">Named</button>
          <button type="button">
            <span className={`codicon ${icon}`} />
          </button>
        </div>,
      );
      expect(() => collectControls(container)).toThrow(
        new RegExp(`button.*no accessible name.*${icon}`, "s"),
      );
    },
  );

  it("expectControlsCovered reports a control no test clicks", async () => {
    const state = () =>
      render(
        <div>
          <button type="button">Known</button>
          <button type="button">Untested</button>
          <input type="checkbox" aria-label="Also untested" />
        </div>,
      ).container;
    const tested: ControlId[] = ["button:Known"];
    const failure = await expectControlsCovered({ fake: state }, tested).then(
      () => undefined,
      (error: unknown) => (error as Error).message,
    );
    expect(failure).toContain("button:Untested (in: fake)");
    expect(failure).toContain("checkbox:Also untested (in: fake)");
    expect(failure).not.toContain("button:Known");
    await expect(
      expectControlsCovered({ fake: state }, [
        ...tested,
        "button:Untested",
        "checkbox:Also untested",
      ]),
    ).resolves.toBeUndefined();
  });
});
