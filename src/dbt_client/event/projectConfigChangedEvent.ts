import { Project } from "../../projects/project";
export class ProjectConfigChangedEvent {
  constructor(public project: Project) {}
}
