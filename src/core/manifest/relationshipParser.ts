import type { Log } from "../log";
import { refsFromContracts } from "./contractRelationships";
import { declaredRefs } from "./declaredRelationships";
import { buildRelationIndex } from "./relationIndex";
import { type InferenceOptions, inferRefs } from "./relationshipInference";
import { refsFromSemanticEntities } from "./semanticRelationships";
import { refsFromTests } from "./testRelationships";
import type {
  NodeMetaMap,
  Ref,
  SemanticModelMetaMap,
  SourceMetaMap,
  TestMetaMap,
} from "./types";

/**
 * Builds `Ref[]` records that describe PK/FK relationships between dbt nodes.
 *
 * - `fromTests` — relationships data tests (Phase 1)
 * - `fromContracts` — model contract foreign_key constraints (Phase 2)
 * - `fromMeta` — relationships declared in `meta.relationships` (declared)
 * - `fromInference` — naming-convention inference (Phase 3)
 * - `fromSemanticEntities` — semantic-layer entity pairings (Phase 4)
 *
 * The phases live in their own modules; this class is the facade callers use.
 * All of them return uniformly-shaped `Ref` records distinguished by the
 * `source` discriminator so downstream consumers can style/filter without
 * the parser knowing about UI.
 */
export class RelationshipParser {
  private terminal: Pick<Log, "debug">;

  constructor(terminal: Pick<Log, "debug">) {
    this.terminal = terminal;
  }

  /** Extract refs from relationships data tests; see {@link refsFromTests}. */
  fromTests(testMetaMap: TestMetaMap): Ref[] {
    return refsFromTests(this.terminal, testMetaMap);
  }

  /** Extract refs from model contract constraints; see {@link refsFromContracts}. */
  fromContracts(
    nodeMetaMap: NodeMetaMap,
    sourceMetaMap?: SourceMetaMap,
  ): Ref[] {
    return refsFromContracts(this.terminal, nodeMetaMap, sourceMetaMap);
  }

  /**
   * Extract refs declared by hand in `meta.relationships` on a node or a source
   * table. The declaring side is the `from` side, so every ref is
   * `many-to-one`, and its id is `meta:<declaring unique_id>[<index>]`.
   *
   * ```yaml
   * models:
   *   - name: orders
   *     meta:
   *       relationships:
   *         - from_columns: [customer_id]
   *           to: "ref('customers')"
   *           to_columns: [id]
   * ```
   *
   * - `to` is a `ref()` or `source()` expression, resolved as `resolveTarget` does (in `relationIndex.ts`): a `ref`
   *   name resolves to the declaring package's own node, then the latest version. A `source_name.table` that more
   *   than one source table claims does not resolve.
   * - `config.meta.relationships` is read when `meta` has no `relationships`
   *   key, because Fusion places a node's `meta` under its config.
   * - `meta.ignore_in_erd: true` on the declaring node or table drops all of
   *   its declared relationships.
   * - An entry that is malformed, does not resolve, or carries `cases` or
   *   `to_schema` (a consumer-specific registration DSL this parser does not
   *   support) is skipped and logged at debug level.
   */
  fromMeta(nodeMetaMap: NodeMetaMap, sourceMetaMap?: SourceMetaMap): Ref[] {
    if (!nodeMetaMap) {
      return [];
    }
    const index = buildRelationIndex(nodeMetaMap, sourceMetaMap);
    return declaredRefs(nodeMetaMap, sourceMetaMap, {
      index,
      terminal: this.terminal,
    });
  }

  /** Infers refs from column-naming conventions; see {@link inferRefs}. */
  fromInference(
    nodeMetaMap: NodeMetaMap,
    sourceMetaMap: SourceMetaMap | undefined,
    options: InferenceOptions = {},
  ): Ref[] {
    return inferRefs({
      terminal: this.terminal,
      nodeMetaMap,
      sourceMetaMap,
      options,
    });
  }

  /** Extract refs by pairing semantic-layer entities; see {@link refsFromSemanticEntities}. */
  fromSemanticEntities(
    semanticModelMetaMap: SemanticModelMetaMap | undefined,
  ): Ref[] {
    return refsFromSemanticEntities(this.terminal, semanticModelMetaMap);
  }
}
