import { describe, expect, it, vi } from "vitest";
import { window } from "vscode";
import { registerProjectPickerCommands } from "../../features/projectPicker/commands";

describe("fusionPowerUser.pickProject", () => {
  function registeredHandler(pickForCommand: () => Promise<unknown>) {
    const register = vi.fn((_id: string, handler: () => unknown) => handler);
    registerProjectPickerCommands(
      { pickForCommand } as never,
      register as never,
    );
    expect(register.mock.calls[0]?.[0]).toBe("fusionPowerUser.pickProject");
    return register.mock.results[0]?.value as () => Promise<void>;
  }

  it("picks through Current Project and confirms the pick", async () => {
    const pickForCommand = vi.fn(() =>
      Promise.resolve({ declared: { name: "analytics" } }),
    );
    const handler = registeredHandler(pickForCommand);

    await handler();

    expect(pickForCommand).toHaveBeenCalledTimes(1);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      "You have successfully selected analytics.",
    );
  });

  it("stays silent when the picker is dismissed", async () => {
    vi.mocked(window.showInformationMessage).mockClear();
    const handler = registeredHandler(() => Promise.resolve(undefined));

    await handler();

    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });
});
