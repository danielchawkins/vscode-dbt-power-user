import { env } from "vscode";
import type { RegisterCommand } from "../../commandRegistry";

export function registerModelTreeCommands(register: RegisterCommand) {
  return [
    register("fusionPowerUser.copyModelName", (model) =>
      env.clipboard.writeText(model.label.toString()),
    ),
  ];
}
