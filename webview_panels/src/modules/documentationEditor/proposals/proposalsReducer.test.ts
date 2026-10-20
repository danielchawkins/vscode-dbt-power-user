import type { columnProposals } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import {
  cleared,
  initialProposalsState,
  proposalsReducer,
  received,
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
});
