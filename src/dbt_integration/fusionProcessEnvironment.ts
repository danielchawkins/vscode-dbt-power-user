import { EnvironmentVariables } from "./domain";

/** Environment a Fusion CLI child process inherits. */
export interface FusionProcessEnvironment {
  getEnvironmentVariables(): EnvironmentVariables;
}
