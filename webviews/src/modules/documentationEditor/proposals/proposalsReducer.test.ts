import type { columnProposals } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import {
  accepted,
  acceptedAll,
  chose,
  cleared,
  dismissed,
  initialProposalsState,
  proposalsReducer,
  received,
  skipped,
  toggledOverwrite,
} from "./proposalsReducer";

const typesPayload = (
  model: string,
  column = "id",
): columnProposals.TypeProposalsPayload => ({
  kind: "types",
  model,
  proposals: [{ column, type: "integer", change: "fill" }],
  notFound: [],
});

const descriptionsPayload = (
  model: string,
): columnProposals.DescriptionProposalsPayload => ({
  kind: "descriptions",
  model,
  proposals: [
    {
      column: "id",
      candidates: [
        {
          description: "Order key",
          sources: [{ uniqueId: "model.p.raw", column: "id" }],
        },
      ],
    },
  ],
});

describe("proposalsReducer", () => {
  it("sets the kind's entry with no candidate or overwrite chosen", () => {
    const payload = typesPayload("/models/orders.sql");
    const next = proposalsReducer(initialProposalsState, received(payload));
    expect(next.model).toBe("/models/orders.sql");
    expect(next.byKind.types).toEqual({ payload, choices: {} });
  });

  it("keeps a second kind beside the first", () => {
    const types = typesPayload("/models/orders.sql");
    const descriptions = descriptionsPayload("/models/orders.sql");
    const withTypes = proposalsReducer(initialProposalsState, received(types));
    const next = proposalsReducer(withTypes, received(descriptions));
    expect(next.byKind.types).toEqual({ payload: types, choices: {} });
    expect(next.byKind.descriptions).toEqual({
      payload: descriptions,
      choices: {},
    });
  });

  it("replaces only the kind that is received again", () => {
    const first = typesPayload("/models/orders.sql", "id");
    const descriptions = descriptionsPayload("/models/orders.sql");
    const again = typesPayload("/models/orders.sql", "amount");
    const state = [first, descriptions].reduce(
      (current, payload) => proposalsReducer(current, received(payload)),
      initialProposalsState,
    );
    const next = proposalsReducer(state, received(again));
    expect(next.byKind.types).toEqual({ payload: again, choices: {} });
    expect(next.byKind.descriptions).toBe(state.byKind.descriptions);
  });

  it("empties the state on cleared", () => {
    const withTypes = proposalsReducer(
      initialProposalsState,
      received(typesPayload("/models/orders.sql")),
    );
    expect(proposalsReducer(withTypes, cleared())).toEqual(
      initialProposalsState,
    );
  });

  describe("settling proposals", () => {
    const types = (): columnProposals.TypeProposalsPayload => ({
      kind: "types",
      model: "/models/orders.sql",
      source: { kind: "target", target: "dev", relation: "orders" },
      proposals: [
        { column: "id", type: "integer", change: "fill" },
        {
          column: "amount",
          type: "numeric",
          change: "overwrite",
          current: "float",
        },
        { column: "note", type: "text", change: "add" },
      ],
      notFound: ["legacy"],
    });

    const upstream = (): columnProposals.DescriptionProposalsPayload => ({
      kind: "descriptions",
      model: "/models/orders.sql",
      proposals: [
        {
          column: "id",
          candidates: [
            {
              description: "Order key",
              sources: [{ uniqueId: "model.p.raw", column: "id" }],
            },
          ],
        },
        {
          column: "status",
          candidates: [
            {
              description: "Status",
              sources: [{ uniqueId: "model.p.a", column: "status" }],
            },
            {
              description: "State",
              sources: [{ uniqueId: "model.p.b", column: "state" }],
            },
          ],
        },
      ],
    });

    const pendingState = () =>
      [types(), upstream()].reduce(
        (current, payload) => proposalsReducer(current, received(payload)),
        initialProposalsState,
      );

    it("removes one accepted proposal and leaves the rest", () => {
      const next = proposalsReducer(
        pendingState(),
        accepted({ kind: "types", column: "id" }),
      );
      expect(next.byKind.types?.payload.proposals.map((p) => p.column)).toEqual(
        ["amount", "note"],
      );
      expect(next.byKind.descriptions).toEqual(
        pendingState().byKind.descriptions,
      );
    });

    it("skips one description without choosing it", () => {
      const next = proposalsReducer(
        pendingState(),
        skipped({ kind: "descriptions", column: "status" }),
      );
      expect(
        next.byKind.descriptions?.payload.proposals.map((p) => p.column),
      ).toEqual(["id"]);
      expect(next.byKind.descriptions?.choices).toEqual({});
    });

    it("keeps the unticked overwrite and the multi-candidate description on accept all", () => {
      const next = proposalsReducer(pendingState(), acceptedAll());
      expect(next.byKind.types?.payload.proposals.map((p) => p.column)).toEqual(
        ["amount"],
      );
      expect(
        next.byKind.descriptions?.payload.proposals.map((p) => p.column),
      ).toEqual(["status"]);
    });

    it("drops a ticked overwrite and a picked description on accept all", () => {
      const ticked = proposalsReducer(
        proposalsReducer(
          pendingState(),
          toggledOverwrite({ column: "amount" }),
        ),
        chose({ column: "status", candidate: 1 }),
      );
      const next = proposalsReducer(ticked, acceptedAll());
      expect(next.byKind.types?.payload.proposals).toEqual([]);
      expect(next.byKind.descriptions?.payload.proposals).toEqual([]);
    });

    it("chooses a candidate by the lower-cased column name", () => {
      const next = proposalsReducer(
        pendingState(),
        chose({ column: "Status", candidate: 1 }),
      );
      expect(next.byKind.descriptions?.choices).toEqual({
        status: { candidate: 1 },
      });
    });

    it("flips the overwrite tick on each toggle", () => {
      const once = proposalsReducer(
        pendingState(),
        toggledOverwrite({ column: "amount" }),
      );
      expect(once.byKind.types?.choices).toEqual({
        amount: { overwrite: true },
      });
      const twice = proposalsReducer(
        once,
        toggledOverwrite({ column: "amount" }),
      );
      expect(twice.byKind.types?.choices.amount).toEqual({ overwrite: false });
    });

    it("dismisses one kind and keeps the other", () => {
      const next = proposalsReducer(
        pendingState(),
        dismissed({ kind: "types" }),
      );
      expect(next.byKind.types).toBeUndefined();
      expect(next.byKind.descriptions).toEqual(
        pendingState().byKind.descriptions,
      );
    });
  });
});
