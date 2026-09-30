import { Project } from "../../projects/project";

export class RunResultsEvent {
  constructor(
    public project: Project,
    public uniqueIds?: string[],
  ) {}
}
