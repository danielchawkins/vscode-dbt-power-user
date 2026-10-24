import { CommandProcessExecutionFactory } from "../fusion/commandProcessExecution";
import { FusionCli } from "../fusion/fusionCli";
import { type FusionExecutable } from "../fusion/fusionExecutable";
import type { ProjectEnvironments } from "../projects/clients/projectEnvironments";
import { readProjectSnapshot } from "../projects/clients/readProjectSnapshot";
import type { ChannelLog } from "../projects/output/outputChannels";
import type { DeclaredProject } from "../projects/registry/projectRegistry";

export function cliFactoryFor(
  declared: DeclaredProject,
  environments: ProjectEnvironments,
  log: ChannelLog,
): (executable: FusionExecutable) => FusionCli {
  const processes = new CommandProcessExecutionFactory(log);
  return (executable) => {
    const source = environments.snapshotSource(declared, readProjectSnapshot);
    return new FusionCli(
      executable,
      source.snapshot,
      processes,
      log,
      source.ready,
    );
  };
}
