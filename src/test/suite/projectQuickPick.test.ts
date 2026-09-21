import { describe, expect, it, jest } from "@jest/globals";
import { Uri, window } from "vscode";
import { DeclaredProject } from "../../projects/projectRegistry";
import { ProjectQuickPick } from "../../quickpick/projectQuickPick";

describe("ProjectQuickPick.declaredProjectPicker", () => {
  const project1: DeclaredProject = {
    root: Uri.file("/workspace/projects/general"),
    name: "general_project",
    folder: { uri: Uri.file("/workspace") } as any,
    contains: jest.fn(() => true),
    dispose: jest.fn(),
  };

  const project2: DeclaredProject = {
    root: Uri.file("/workspace/projects/sox"),
    name: "sox_project",
    folder: { uri: Uri.file("/workspace") } as any,
    contains: jest.fn(() => true),
    dispose: jest.fn(),
  };

  it("returns selected DeclaredProject with name/path items and canPickMany false", async () => {
    jest.spyOn(window, "showQuickPick").mockResolvedValue({
      label: "general_project",
      description: "/workspace/projects/general",
      project: project1,
    } as any);

    const picker = new ProjectQuickPick();
    const result = await picker.declaredProjectPicker([project1, project2]);

    expect(result).toBe(project1);

    const [items, options] = (window.showQuickPick as jest.Mock).mock
      .calls[0] as any[];
    expect(items[0].label).toBe("general_project");
    expect(items[0].description).toBe("/workspace/projects/general");
    expect(options.canPickMany).toBe(false);
    expect(options.title).toBe("Select a Project");
  });

  it("returns undefined on cancellation", async () => {
    jest.spyOn(window, "showQuickPick").mockResolvedValue(undefined);

    const picker = new ProjectQuickPick();
    const result = await picker.declaredProjectPicker([project1]);

    expect(result).toBeUndefined();
  });
});
