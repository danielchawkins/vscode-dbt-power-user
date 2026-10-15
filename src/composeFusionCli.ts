import type { Log } from "./core/log";
import type { ExtensionContextStore } from "./extensionContext";
import { CommandProcessExecutionFactory } from "./fusion/commandProcessExecution";
import { FusionCli } from "./fusion/fusionCli";
import {
  ConfiguredFusionExecutableResolver,
  type FusionExecutable,
} from "./fusion/fusionExecutable";
import type { ChannelLog } from "./projects/outputChannels";
import type { ProjectEnvironments } from "./projects/projectEnvironments";
import type { DeclaredProject } from "./projects/projectRegistry";
import { readProjectSnapshot } from "./projects/readProjectSnapshot";

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
export function createExecutableResolver(
  terminal: Log,
  store: ExtensionContextStore,
): ConfiguredFusionExecutableResolver {
  return new ConfiguredFusionExecutableResolver({
    logWarning: (message) => terminal.warn("FusionVersion", message),
    getGlobalState: () => ({
      get: (key) => store.getFromGlobalState(key),
      update: (key, value) => store.setToGlobalState(key, value),
    }),
  });
}
