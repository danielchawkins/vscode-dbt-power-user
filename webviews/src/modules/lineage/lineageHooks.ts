import type { lineage } from "@fusion-power-user/webview-contract";
import { writeViewState } from "@modules/app/viewState";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { GraphState, GraphStore } from "./graph";
import { framedCards, withHidden } from "./graph";
import { executeRequestInAsync } from "./requests";
import { viewStateOf } from "./viewModel";

/** Applies the hidden cards once the host sends them. Declared before the held render, so that render sees them. */
export function useHiddenSeed(
  current: () => GraphStore,
  hidden: lineage.HiddenCard[] | undefined,
): void {
  useEffect(() => {
    if (hidden) {
      current().update((s) => withHidden(s, hidden));
    }
  }, [hidden, current]);
}

/** `handle`, except that while `ready` is false the latest call is held, and replayed once `ready` turns true. */
export function useHeldUntil<T>(
  ready: boolean,
  handle: (value: T) => void,
): (value: T) => void {
  const readyRef = useRef(ready);
  const heldRef = useRef<{ value: T }>(undefined);
  useEffect(() => {
    readyRef.current = ready;
    const held = heldRef.current;
    if (ready && held) {
      heldRef.current = undefined;
      handle(held.value);
    }
  }, [ready, handle]);
  return useCallback(
    (value: T) => {
      if (readyRef.current) {
        handle(value);
      } else {
        heldRef.current = { value };
      }
    },
    [handle],
  );
}

/** The cards the whole view fits to: those within the default expansion of the start; undefined in the neighbourhood. */
export function useWholeFrame(
  graph: GraphState,
  defaultExpansion: () => number,
): string[] | undefined {
  return useMemo(
    () =>
      graph.view.viewMode === "whole"
        ? [...framedCards(graph, defaultExpansion())]
        : undefined,
    [graph, defaultExpansion],
  );
}

/**
 * Writes the view state of a settled graph, so a reload draws the same view. A rebuild's partial graph is not written;
 * `drawnKey` advances when it settles.
 */
export function useViewStateWriter({
  graph,
  drawnKey,
  buildingRef,
  restoredRef,
  publicationRef,
}: {
  graph: GraphState;
  drawnKey: number;
  buildingRef: RefObject<boolean>;
  restoredRef: RefObject<boolean>;
  publicationRef: RefObject<string | undefined>;
}): void {
  useEffect(() => {
    const state =
      restoredRef.current && !buildingRef.current
        ? viewStateOf(graph, publicationRef.current)
        : undefined;
    if (state) {
      writeViewState(state);
    }
  }, [graph, drawnKey, buildingRef, restoredRef, publicationRef]);
}

/** Listens for the host's render and project-saved messages, and asks for the init that the panel starts with. */
export function useHostMessages(
  onRender: (args: lineage.RenderArgs | undefined) => void,
  onProjectSaved: () => void,
): void {
  useEffect(() => {
    const onMessage = (event: MessageEvent<lineage.HostMessage>) => {
      const message = event.data;
      if (message.command === "render") {
        onRender(message.args);
      }
      if (message.command === "projectSaved") {
        onProjectSaved();
        executeRequestInAsync("init");
      }
    };
    window.addEventListener("message", onMessage);
    executeRequestInAsync("init");
    return () => window.removeEventListener("message", onMessage);
  }, [onRender, onProjectSaved]);
}
