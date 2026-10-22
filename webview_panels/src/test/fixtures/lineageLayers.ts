/**
 * The lineage-layers dbt fixture (src/test/fixtures/lineage-layers) as the webview receives it: the tables, the dbt
 * dependency edges and the declared relationships around `int_orders__enriched`. The dbt project is the source of
 * truth; keep this file in step with its models.
 */
import type { lineage } from "@fusion-power-user/webview-contract";

const PACKAGE = "lineage_layers";

const SOURCE = `source.${PACKAGE}.shop.orders`;
const SEED = `seed.${PACKAGE}.country_codes`;
const STG_ORDERS = `model.${PACKAGE}.stg_shop__orders`;
const STG_ACCOUNTS = `model.${PACKAGE}.stg_backend__accounts`;
const STG_USERS = `model.${PACKAGE}.stg_backend__users`;
const INT_ORDERS = `model.${PACKAGE}.int_orders__enriched`;
const DIM_CUSTOMERS = `model.${PACKAGE}.dim_customers`;
const FCT_ORDERS = `model.${PACKAGE}.fct_orders`;
const REV_DAILY = `model.${PACKAGE}.fct_finance__daily_revenue_by_region_and_channel`;
const AUDIT_LOG = `model.${PACKAGE}.audit_log`;

export const lineageLayersIds = {
  SOURCE,
  SEED,
  STG_ORDERS,
  STG_ACCOUNTS,
  STG_USERS,
  INT_ORDERS,
  DIM_CUSTOMERS,
  FCT_ORDERS,
  REV_DAILY,
  AUDIT_LOG,
} as const;

const DATABASE = "lineage_layers";

/** A column as the manifest holds it: the entry `nodeTable` and `sourceTable` copy onto the table. */
interface FixtureColumn {
  name: string;
  description: string;
  data_type: string;
  meta: Record<string, unknown>;
}

/**
 * A table as `lineageTable` builds it: the webview's `LineageTable`, plus the `columns` and `patchPath` the host's
 * `Table` carries. The contract's `LineageTable` does not declare those two, so this type adds them.
 */
type FixtureTable = lineage.LineageTable & {
  columns: Record<string, FixtureColumn>;
  patchPath?: string;
};

/** The columns a YAML lists by name, with no description or type set. */
const columnsOf = (...names: string[]): Record<string, FixtureColumn> =>
  Object.fromEntries(
    names.map((name) => [
      name,
      { name, description: "", data_type: "", meta: {} },
    ]),
  );

/** The facts a model card shows that come from its dbt node, as `nodeTable` reads them. */
interface ModelFacts {
  /** The alias the card is titled with. */
  label: string;
  materialization: "view" | "table";
  /** The relation's schema: the target schema with the custom schema on it, e.g. `main_staging`. */
  schema: string;
  /** The node's configured `schema`, e.g. `staging`. */
  customSchema?: string;
  layer?: string;
  description: string;
  childCount: number;
  parentCount: number;
  hidden?: true;
  meta?: Record<string, unknown>;
  columns: Record<string, FixtureColumn>;
}

/** A model card as `nodeTable` builds it: `refName` is the dbt name, set only when the alias differs from it. */
const model = (id: string, path: string, facts: ModelFacts): FixtureTable => {
  const name = id.split(".").at(-1) ?? id;
  return {
    table: id,
    nodeType: "model",
    packageName: PACKAGE,
    rootPackage: true,
    database: DATABASE,
    path,
    // The model's YAML sits beside its SQL, and dbt names it `<package>://<path>`.
    patchPath: `${PACKAGE}://${path.replace(/\.sql$/, ".yml")}`,
    tests: [],
    meta: {},
    ...facts,
    ...(facts.label === name ? {} : { refName: name }),
  };
};

/**
 * Every node the fixture draws, with the fields `lineageTable` gives it for the lineage-layers project. The start
 * table is `int_orders__enriched`, which the panel opens on, and `audit_log` is hidden by its meta.
 *
 * Left out: `url`, which depends on the workspace. `layer` comes from the folder, as `nodeTable` infers it.
 */
export const lineageLayersTables: FixtureTable[] = [
  {
    table: SOURCE,
    label: "orders",
    nodeType: "source",
    description: "Raw orders from the shop application.",
    childCount: 2,
    parentCount: 0,
    packageName: PACKAGE,
    rootPackage: true,
    database: DATABASE,
    schema: "shop",
    tests: [],
    columns: columnsOf("order_id", "customer_id", "amount"),
  },
  {
    table: SEED,
    label: "country_codes",
    nodeType: "seed",
    materialization: "seed",
    description: "Country codes that users and revenue regions use.",
    childCount: 1,
    parentCount: 0,
    packageName: PACKAGE,
    rootPackage: true,
    database: DATABASE,
    schema: "main",
    path: "seeds/country_codes.csv",
    patchPath: `${PACKAGE}://seeds/country_codes.yml`,
    tests: [],
    meta: {},
    columns: {
      code: {
        name: "code",
        description: "Two-letter ISO country code.",
        data_type: "",
        meta: {},
      },
      name: {
        name: "name",
        description: "Country name.",
        data_type: "",
        meta: {},
      },
    },
  },
  model(STG_ORDERS, "models/13_staging/shop/stg_shop__orders.sql", {
    label: "orders",
    materialization: "view",
    schema: "main_staging",
    customSchema: "staging",
    layer: "staging",
    description: "Shop orders with their order key and amount.",
    childCount: 1,
    parentCount: 1,
    columns: columnsOf("order_id", "amount"),
  }),
  model(STG_ACCOUNTS, "models/13_staging/backend/stg_backend__accounts.sql", {
    label: "accounts",
    materialization: "view",
    schema: "main_staging",
    customSchema: "staging",
    layer: "staging",
    description: "Backend accounts, one row per account.",
    childCount: 1,
    parentCount: 0,
    columns: columnsOf("account_id", "user_id"),
    meta: {
      relationships: [
        {
          from_columns: ["user_id"],
          to_columns: ["user_id"],
          to: "ref('stg_backend__users')",
        },
      ],
    },
  }),
  model(STG_USERS, "models/13_staging/backend/stg_backend__users.sql", {
    label: "users",
    materialization: "view",
    schema: "main_staging",
    customSchema: "staging",
    layer: "staging",
    description: "Backend users, one row per user.",
    childCount: 2,
    parentCount: 0,
    columns: columnsOf("user_id", "country_code"),
  }),
  model(INT_ORDERS, "models/21_intermediate/int_orders__enriched.sql", {
    label: "orders_enriched",
    materialization: "table",
    schema: "main_intermediate",
    customSchema: "intermediate",
    layer: "intermediate",
    description:
      "Orders joined to their account, user and country. The model the lineage panel starts from.",
    childCount: 4,
    parentCount: 5,
    columns: columnsOf("order_id", "customer_id", "amount"),
    meta: {
      relationships: [
        {
          from_columns: ["customer_id"],
          to_columns: ["customer_id"],
          to: "ref('dim_customers')",
        },
      ],
    },
  }),
  model(DIM_CUSTOMERS, "models/31_marts/dim_customers.sql", {
    label: "dim_customers",
    materialization: "table",
    schema: "main_marts",
    customSchema: "marts",
    layer: "marts",
    description: "One row per customer.",
    childCount: 1,
    parentCount: 1,
    columns: columnsOf("customer_id"),
  }),
  model(FCT_ORDERS, "models/31_marts/fct_orders.sql", {
    label: "fct_orders",
    materialization: "table",
    schema: "main_marts",
    customSchema: "marts",
    layer: "marts",
    description: "One row per order, with its amount in USD.",
    childCount: 0,
    parentCount: 2,
    columns: columnsOf("order_id", "customer_id", "amount_usd", "ordered_at"),
    meta: {
      relationships: [
        {
          from_columns: ["customer_id"],
          to_columns: ["customer_id"],
          to: "ref('dim_customers')",
        },
      ],
    },
  }),
  model(
    REV_DAILY,
    "models/31_marts/finance/fct_finance__daily_revenue_by_region_and_channel.sql",
    {
      label: "daily_revenue",
      materialization: "table",
      schema: "main_marts",
      customSchema: "marts",
      layer: "marts",
      description:
        "Revenue per region. Its region is a declared key to country_codes, not a data flow.",
      childCount: 0,
      parentCount: 2,
      columns: columnsOf("region", "revenue_usd"),
      meta: {
        relationships: [
          {
            from_columns: ["region"],
            to_columns: ["code"],
            to: "ref('country_codes')",
          },
        ],
      },
    },
  ),
  model(AUDIT_LOG, "models/41_ops/audit_log.sql", {
    label: "audit_log",
    materialization: "view",
    schema: "main",
    description:
      "Ops audit trail. Hidden from lineage, so its edges are not drawn.",
    childCount: 0,
    parentCount: 1,
    hidden: true,
    columns: {},
    meta: { lineage: { hidden: true } },
  }),
];

/** Every dbt dependency edge as `[parent, child]`, the hidden `audit_log` edge included. */
export const lineageLayersEdges: [string, string][] = [
  [SOURCE, STG_ORDERS],
  [STG_ORDERS, INT_ORDERS],
  [SEED, INT_ORDERS],
  [STG_ACCOUNTS, INT_ORDERS],
  [STG_USERS, INT_ORDERS],
  [INT_ORDERS, FCT_ORDERS],
  [INT_ORDERS, DIM_CUSTOMERS],
  [INT_ORDERS, REV_DAILY],
  [INT_ORDERS, AUDIT_LOG],
  [DIM_CUSTOMERS, FCT_ORDERS],
  // The legacy shortcuts: the source feeds the intermediate model, and the users feed the revenue mart.
  [SOURCE, INT_ORDERS],
  [STG_USERS, REV_DAILY],
];

const relationship = (
  from: string,
  fromColumn: string,
  to: string,
  toColumn: string,
): lineage.LineageRef => ({
  id: `meta:${from}.${fromColumn}->${to}.${toColumn}`,
  from: { table: from, columns: [fromColumn] },
  to: { table: to, columns: [toColumn] },
  cardinality: "many-to-one",
  source: "meta",
});

/** The five declared relationships: four `meta.relationships` in YAML, and the shop source's own. */
export const lineageLayersRefs: lineage.LineageRef[] = [
  relationship(SOURCE, "customer_id", STG_USERS, "user_id"),
  relationship(STG_ACCOUNTS, "user_id", STG_USERS, "user_id"),
  relationship(INT_ORDERS, "customer_id", DIM_CUSTOMERS, "customer_id"),
  relationship(FCT_ORDERS, "customer_id", DIM_CUSTOMERS, "customer_id"),
  relationship(REV_DAILY, "region", SEED, "code"),
];

/** The table map `hiddenTables` reads, keyed by table ID. */
export const lineageLayersKnown: Record<string, lineage.LineageTable> =
  Object.fromEntries(lineageLayersTables.map((table) => [table.table, table]));
