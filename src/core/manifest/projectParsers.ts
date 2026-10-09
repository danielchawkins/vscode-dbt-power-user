import type { Log } from "../log";
import { ChildrenParentParser } from "./childrenParentParser";
import { DocParser } from "./docParser";
import { ExposureParser } from "./exposureParser";
import { FunctionParser } from "./functionParser";
import { GraphParser } from "./graphParser";
import { MacroParser } from "./macroParser";
import { MetricParser } from "./metricParser";
import { NodeParser } from "./nodeParser";
import { SemanticModelParser } from "./semanticModelParser";
import { SourceParser } from "./sourceParser";
import { TestParser } from "./testParser";
import { UnitTestParser } from "./unitTestParser";

/** Builds a fresh set of manifest parsers; each Project gets its own. */
export function createProjectParsers(terminal: Log) {
  return {
    childrenParentParser: new ChildrenParentParser(),
    nodeParser: new NodeParser(terminal),
    macroParser: new MacroParser(terminal),
    metricParser: new MetricParser(terminal),
    graphParser: new GraphParser(terminal),
    sourceParser: new SourceParser(terminal),
    testParser: new TestParser(terminal),
    unitTestParser: new UnitTestParser(terminal),
    exposureParser: new ExposureParser(terminal),
    functionParser: new FunctionParser(terminal),
    docParser: new DocParser(terminal),
    semanticModelParser: new SemanticModelParser(terminal),
  };
}
