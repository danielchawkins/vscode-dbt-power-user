import { describe, expect, it } from "vitest";
import type {
  AnsweredTypes,
  DocColumn,
} from "../../core/columns/typeProposals";
import type { TypeSourceOutcome } from "../../core/columns/typeSourceMessage";
import type { NeedsStrict } from "../../core/snapshot/strictNeeded";
import type { TypeTarget } from "../../features/docs/columnProposalPayloads";
import {
  descriptionPayloadOf,
  payloadOf,
} from "../../features/docs/columnProposalPayloads";
import type { ModelRef } from "../../features/docs/columnTypeSource";
import type { UpstreamDescriptionOutcome } from "../../features/docs/upstreamDescriptionSource";

const MODEL: ModelRef = { name: "orders", filePath: "/p/models/orders.sql" };
const YAML: DocColumn[] = [{ name: "id", type: "integer" }];
const TARGET: TypeTarget = { model: MODEL, yaml: YAML };
const STRICT_ACTION = [
  { title: "Use strict analysis", action: "useStrictAnalysis" },
];
const OVERWRITE_ID = [
  { column: "id", type: "varchar", change: "overwrite", current: "integer" },
];
const ANSWER_COLUMNS = [{ column: "id", dtype: "varchar" }];
const TARGET_SOURCE = {
  kind: "target",
  target: "dev",
  relation: "db.s.orders",
};
const TARGET_ANSWER: AnsweredTypes = {
  source: "target",
  target: "dev",
  relation: "db.s.orders",
  columns: ANSWER_COLUMNS,
};
const MISSING_TARGET: TypeSourceOutcome["attempts"] = [
  { source: "target", result: "missing", target: "dev" },
  { source: "deferred", result: "notConfigured", detail: "off" },
];
const ANSWERED_TARGET: TypeSourceOutcome = {
  attempts: [{ source: "target", result: "answered" }],
  answered: TARGET_ANSWER,
};

describe("payloadOf", () => {
  const cases: {
    name: string;
    target: TypeTarget;
    outcome: TypeSourceOutcome;
    strictNeeded: boolean;
    expected: unknown;
  }[] = [
    {
      name: "proposes a target answer's types over the YAML's, with no notice",
      target: TARGET,
      outcome: ANSWERED_TARGET,
      strictNeeded: false,
      expected: {
        kind: "types",
        model: MODEL.filePath,
        source: TARGET_SOURCE,
        proposals: OVERWRITE_ID,
        notFound: [],
      },
    },
    {
      name: "proposes from the draft over the YAML",
      target: { ...TARGET, draft: [{ name: "id", type: "varchar" }] },
      outcome: ANSWERED_TARGET,
      strictNeeded: false,
      expected: {
        kind: "types",
        model: MODEL.filePath,
        source: TARGET_SOURCE,
        proposals: [],
        notFound: [],
      },
    },
    {
      name: "names a target answer's source with empty fields when it has none",
      target: TARGET,
      outcome: {
        attempts: [{ source: "target", result: "answered" }],
        answered: { source: "target", columns: ANSWER_COLUMNS },
      },
      strictNeeded: false,
      expected: {
        kind: "types",
        model: MODEL.filePath,
        source: { kind: "target", target: "", relation: "" },
        proposals: OVERWRITE_ID,
        notFound: [],
      },
    },
    {
      name: "names a deferred answer's source with empty fields when it has none",
      target: TARGET,
      outcome: {
        attempts: [{ source: "deferred", result: "answered" }],
        answered: { source: "deferred", columns: ANSWER_COLUMNS },
      },
      strictNeeded: false,
      expected: {
        kind: "types",
        model: MODEL.filePath,
        source: { kind: "deferred", target: "", relation: "", state: "" },
        proposals: OVERWRITE_ID,
        notFound: [],
      },
    },
    {
      name: "names the deferred relation and its state, with no notice",
      target: TARGET,
      outcome: {
        attempts: [
          { source: "target", result: "missing", target: "dev" },
          { source: "deferred", result: "answered" },
        ],
        answered: {
          source: "deferred",
          target: "prod",
          relation: "db.s.orders",
          state: "/work/state",
          columns: ANSWER_COLUMNS,
        },
      },
      strictNeeded: false,
      expected: {
        kind: "types",
        model: MODEL.filePath,
        source: {
          kind: "deferred",
          target: "prod",
          relation: "db.s.orders",
          state: "/work/state",
        },
        proposals: OVERWRITE_ID,
        notFound: [],
      },
    },
    {
      name: "warns with the inferred types and offers no strict action",
      target: TARGET,
      outcome: {
        attempts: [{ source: "inferred", result: "answered" }],
        answered: { source: "inferred", columns: ANSWER_COLUMNS },
      },
      strictNeeded: true,
      expected: {
        kind: "types",
        model: MODEL.filePath,
        source: { kind: "inferred" },
        proposals: OVERWRITE_ID,
        notFound: [],
        notice: { message: expect.any(String), type: "warning" },
      },
    },
    {
      name: "errors when nothing answered, with no strict action when static analysis is not needed",
      target: TARGET,
      outcome: {
        attempts: [
          ...MISSING_TARGET,
          { source: "inferred", result: "unavailable", detail: "not strict" },
        ],
      },
      strictNeeded: false,
      expected: {
        kind: "types",
        model: MODEL.filePath,
        proposals: [],
        notFound: [],
        notice: {
          message: expect.stringContaining("is not built"),
          type: "error",
        },
      },
    },
    {
      name: "errors with the strict action when static analysis is needed for the inferred types",
      target: TARGET,
      outcome: {
        attempts: [
          ...MISSING_TARGET,
          { source: "inferred", result: "unavailable", detail: "not strict" },
        ],
      },
      strictNeeded: true,
      expected: {
        kind: "types",
        model: MODEL.filePath,
        proposals: [],
        notFound: [],
        notice: {
          message: expect.stringContaining("is not built"),
          type: "error",
          actions: STRICT_ACTION,
        },
      },
    },
    {
      name: "errors with no strict action when the inferred types are missing rather than unavailable",
      target: TARGET,
      outcome: {
        attempts: [
          ...MISSING_TARGET,
          { source: "inferred", result: "missing" },
        ],
      },
      strictNeeded: true,
      expected: {
        kind: "types",
        model: MODEL.filePath,
        proposals: [],
        notFound: [],
        notice: {
          message: expect.stringContaining("is not built"),
          type: "error",
        },
      },
    },
  ];

  it.each(cases)("$name", ({ target, outcome, strictNeeded, expected }) => {
    expect(payloadOf(target, outcome, strictNeeded)).toEqual(expected);
  });
});

const PROPOSAL = {
  column: "grand_total",
  candidates: [
    {
      description: "Order total",
      sources: [{ uniqueId: "model.lineage.order_totals", column: "total" }],
    },
  ],
};
const STRICT_NOTICE = {
  kind: "descriptions",
  model: MODEL.filePath,
  proposals: [],
  notice: {
    message: expect.stringContaining("needs strict static analysis"),
    type: "warning",
    actions: STRICT_ACTION,
  },
};

describe("descriptionPayloadOf", () => {
  const cases: {
    name: string;
    outcome: UpstreamDescriptionOutcome;
    needs?: NeedsStrict;
    expected: unknown;
  }[] = [
    {
      name: "reports a language server that is not running as an error",
      outcome: { kind: "notRunning", state: "stopped" },
      expected: {
        kind: "descriptions",
        model: MODEL.filePath,
        proposals: [],
        notice: {
          message:
            "Upstream descriptions need the Fusion language server running; it is stopped.",
          type: "error",
        },
      },
    },
    {
      name: "offers the strict action when static analysis is not strict",
      outcome: { kind: "needsStrict" },
      expected: {
        kind: "descriptions",
        model: MODEL.filePath,
        proposals: [],
        notice: {
          message: "Upstream descriptions need strict static analysis.",
          type: "warning",
          actions: STRICT_ACTION,
        },
      },
    },
    {
      name: "names the strict-needed reason when the mode is known",
      outcome: { kind: "needsStrict" },
      needs: { mode: "off", setting: "strict" },
      expected: {
        ...STRICT_NOTICE,
        notice: {
          ...STRICT_NOTICE.notice,
          message: expect.stringContaining(
            "Proposing upstream descriptions needs strict static analysis, but this project runs off.",
          ),
        },
      },
    },
    {
      name: "keeps the proposals found before a failed request, with the error notice",
      outcome: {
        kind: "failed",
        message: "boom",
        error: new Error("boom"),
        proposals: [PROPOSAL],
      },
      expected: {
        kind: "descriptions",
        model: MODEL.filePath,
        proposals: [PROPOSAL],
        notice: {
          message: "Upstream descriptions could not be read: boom",
          type: "error",
        },
      },
    },
    {
      name: "warns when columns were asked about and none got a proposal",
      outcome: { kind: "found", asked: 2, proposals: [] },
      expected: {
        kind: "descriptions",
        model: MODEL.filePath,
        proposals: [],
        notice: {
          message:
            "No upstream copy has a description for the columns without one.",
          type: "warning",
        },
      },
    },
    {
      name: "shows no notice when every column already has a description",
      outcome: { kind: "found", asked: 0, proposals: [] },
      expected: {
        kind: "descriptions",
        model: MODEL.filePath,
        proposals: [],
      },
    },
    {
      name: "shows no notice when a proposal was found",
      outcome: { kind: "found", asked: 2, proposals: [PROPOSAL] },
      expected: {
        kind: "descriptions",
        model: MODEL.filePath,
        proposals: [PROPOSAL],
      },
    },
  ];

  it.each(cases)("$name", ({ outcome, needs, expected }) => {
    expect(descriptionPayloadOf(MODEL, outcome, needs)).toEqual(expected);
  });
});
