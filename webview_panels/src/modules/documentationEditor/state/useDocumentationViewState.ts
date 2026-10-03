import {
  MAX_VIEW_STATE_STRING,
  readViewState,
  writeViewState,
} from "@modules/app/viewState";
import { useEffect, useLayoutEffect, useRef } from "react";
import { setSearchQuery } from "./documentationReducer";
import useDocumentationContext from "./useDocumentationContext";

const SAVE_DELAY_MS = 150;

/**
 * Restores the column search and the scroll position of `scroller` once the host renders the model and
 * manifest publication they were saved for, then saves them as they change.
 */
const useDocumentationViewState = (scroller: HTMLElement | null): void => {
  const {
    state: { currentDocsData, publication, searchQuery },
    dispatch,
  } = useDocumentationContext();
  const model = currentDocsData?.uniqueId;
  const pendingRef = useRef(readViewState("documentationEditor"));

  useLayoutEffect(() => {
    const saved = pendingRef.current;
    if (!saved || model === undefined || !scroller) {
      return;
    }
    pendingRef.current = undefined;
    if (saved.model !== model || saved.publication !== publication) {
      return;
    }
    dispatch(setSearchQuery(saved.searchQuery));
    scroller.scrollTo({ top: saved.scrollTop });
  }, [model, publication, scroller, dispatch]);

  useEffect(() => {
    if (model === undefined || pendingRef.current) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () =>
      writeViewState({
        panel: "documentationEditor",
        publication,
        model,
        scrollTop: Math.round(scroller?.scrollTop ?? 0),
        searchQuery: searchQuery.slice(0, MAX_VIEW_STATE_STRING),
      });
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(save, SAVE_DELAY_MS);
    };
    save();
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, [model, publication, searchQuery, scroller]);
};

export default useDocumentationViewState;
