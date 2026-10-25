/**
 * What the lineage-layers smoke expects to see drawn. `src/test/suite/lineageLayersFixture.test.ts` checks these
 * against the fixture's dbt project.
 */

/** The start model and its direct neighbours: sources and seeds, staging, marts, and the hidden audit_log card. */
export const START = "int_orders__enriched";
export const CARD_IDS = [
  "orders",
  "country_codes",
  "stg_shop__orders",
  "stg_backend__accounts",
  "stg_backend__users",
  "int_orders__enriched",
  "fct_orders",
  "dim_customers",
  "fct_finance__daily_revenue_by_region_and_channel",
  "audit_log",
];
/** The layer bands in draw order. */
export const LAYER_BANDS = [
  "source",
  "staging",
  "intermediate",
  "marts",
  "other",
];
/** The table edges the panel draws: every dbt edge except the one to the hidden audit_log. */
export const DRAWN_TABLE_EDGES = 11;
