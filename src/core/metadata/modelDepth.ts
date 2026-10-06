import type { DBTGraphType } from "../manifest";

/**
 * Longest model-only path from a source to each model, keyed by both name and unique id. A model with no model
 * parents has depth 1.
 */
export function createModelDepthsMap(
  nodeMap: Record<string, { resource_type: string; name: string }>,
  parentMetaMap: DBTGraphType,
  childMetaMap: DBTGraphType,
): Map<string, number> {
  const models = Object.entries(nodeMap)
    .filter(([, node]) => node.resource_type === "model")
    .map(([id, node]) => ({ name: node.name, id }));

  const depths = new Map<string, number>();
  const inDegree = new Map<string, number>();
  for (const model of models) {
    const modelParents = (parentMetaMap[model.id] ?? []).filter((parent) =>
      parent.startsWith("model."),
    );
    depths.set(model.id, modelParents.length === 0 ? 1 : 0);
    inDegree.set(model.id, modelParents.length);
  }

  const queue = models.filter((m) => inDegree.get(m.id) === 0).map((m) => m.id);
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentDepth = depths.get(currentId)!;
    for (const childId of childMetaMap[currentId] ?? []) {
      depths.set(childId, Math.max(depths.get(childId)!, currentDepth + 1));
      const remaining = inDegree.get(childId)! - 1;
      inDegree.set(childId, remaining);
      if (remaining === 0) {
        queue.push(childId);
      }
    }
  }

  const result = new Map<string, number>();
  for (const model of models) {
    const depth = depths.get(model.id)!;
    result.set(model.name, depth);
    result.set(model.id, depth);
  }
  return result;
}
