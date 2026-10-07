import type { CommandProcessResult } from "../core/types";
import type { QueuedCliCommand } from "../fusion/fusionCli";
import { ProjectTaskDeps, ProjectTasks } from "../projects/projectTasks";

/**
 * Project tasks that record the command each task starts instead of launching it. Each started run settles with
 * `result`.
 */
export class RecordingTasks extends ProjectTasks {
  readonly commands: QueuedCliCommand[] = [];

  constructor(private readonly result?: CommandProcessResult) {
    super({} as ProjectTaskDeps);
  }

  override start(cli: QueuedCliCommand) {
    this.commands.push(cli);
    return Promise.resolve({
      started: Promise.resolve(() => Promise.resolve(this.result)),
      ended: Promise.resolve(),
    });
  }
}
