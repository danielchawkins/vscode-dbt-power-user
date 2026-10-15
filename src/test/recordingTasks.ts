import type { CommandProcessResult } from "../core/types";
import type { QueuedCliCommand } from "../fusion/fusionCli";
import type { ProjectTaskDeps } from "../projects/projectTasks";
import { ProjectTasks } from "../projects/projectTasks";

/**
 * Project tasks that record the command each task starts instead of launching it. Each started run settles with
 * `result`.
 */
export class RecordingTasks extends ProjectTasks {
  readonly commands: QueuedCliCommand[] = [];
  private readonly result: CommandProcessResult | undefined;

  constructor(result?: CommandProcessResult) {
    super({} as ProjectTaskDeps);
    this.result = result;
  }

  override start(cli: QueuedCliCommand) {
    this.commands.push(cli);
    return Promise.resolve({
      started: Promise.resolve(() => Promise.resolve(this.result)),
      ended: Promise.resolve(),
    });
  }
}
