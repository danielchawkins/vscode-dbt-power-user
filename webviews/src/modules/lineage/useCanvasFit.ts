import { type FitViewOptions, useReactFlow } from "@xyflow/react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fitGraph,
  fitOptions,
  fitPadding,
  type Fitted,
  noticeOverlap,
  refitsGraph,
} from "./fit";
import { minimapShown, minimapSize } from "./minimap";

/**
 * The fit options for the canvas, and the fits that frame the graph. The canvas is fitted when it is resized or its
 * padding changes, and on each redraw. A change of the drawn nodes, the layout or Connections refits too, unless the
 * user has panned or zoomed since the last fit and the nodes are the same (see `refitsGraph`).
 */
export const useFit = ({
  size,
  minimapShown: showMinimap,
  notice,
  drawnKey,
  layered,
  focusId,
  nodeKey,
  shapeKey,
}: {
  size: { width: number; height: number };
  minimapShown: boolean;
  notice: number;
  drawnKey: number;
  layered: boolean;
  focusId: string | undefined;
  /** The drawn nodes, by id: a change of them is a change of the graph. */
  nodeKey: string;
  /** The layout and Connections: a change of either is a change of the graph's shape. */
  shapeKey: string;
}): { options: FitViewOptions; refit: () => void } => {
  const flow = useReactFlow();
  const { width, height } = size;
  const ready = width > 0 && height > 0;
  const map = minimapSize(size);
  const minimap = useMemo(
    () => (showMinimap ? { width: map.width, height: map.height } : undefined),
    [showMinimap, map.width, map.height],
  );
  const options = useMemo(() => fitOptions(minimap, notice), [minimap, notice]);
  const padding = useMemo(() => fitPadding(minimap, notice), [minimap, notice]);
  const fittedRef = useRef<Fitted | undefined>(undefined);
  const fit = useCallback(
    async (key: string) => {
      await fitGraph({
        flow,
        options,
        padding,
        width,
        height,
        layered,
        focusId,
      });
      fittedRef.current = { nodeKey: key, viewport: flow.getViewport() };
    },
    [flow, options, padding, width, height, layered, focusId],
  );
  // The effects below read the latest fit and node key through these refs, so that only their own changes run them.
  const fitRef = useRef(fit);
  const keyRef = useRef(nodeKey);
  useLayoutEffect(() => {
    fitRef.current = fit;
    keyRef.current = nodeKey;
  });
  useEffect(() => {
    if (ready) {
      void fitRef.current(keyRef.current);
    }
  }, [ready, width, height, options, padding]);
  useEffect(() => {
    if (!ready) {
      return;
    }
    // Waits a frame, so React Flow has measured the nodes that were just drawn.
    requestAnimationFrame(() => {
      if (refitsGraph(fittedRef.current, nodeKey, flow.getViewport())) {
        void fitRef.current(nodeKey);
      }
    });
  }, [flow, ready, nodeKey, shapeKey]);
  useEffect(() => {
    if (drawnKey > 0) {
      requestAnimationFrame(() => void fitRef.current(keyRef.current));
    }
  }, [drawnKey]);
  // The Fit View control runs the same fit as the automatic one, with the same focus and padding.
  const refit = useCallback(() => void fitRef.current(keyRef.current), []);
  return { options, refit };
};
/** The minimap's visibility: the user's choice once made, otherwise whether the canvas has room for it. */
export const useMinimap = (size: {
  width: number;
  height: number;
}): { shown: boolean; toggle: () => void } => {
  const [choice, setChoice] = useState<boolean>();
  const shown = minimapShown(choice, size);
  return { shown, toggle: () => setChoice(!shown) };
};
/**
 * How far the notice above the canvas reaches over the canvas's top edge, in pixels: zero when it sits above the
 * canvas, as it does in the top bar. Both elements are tracked with a `ResizeObserver`, as the canvas size is.
 */
export const useNoticeOverlap = (
  topBar: RefObject<HTMLElement | null>,
  canvas: RefObject<HTMLElement | null>,
  shown: boolean,
): number => {
  const [overlap, setOverlap] = useState(0);
  useLayoutEffect(() => {
    const notice = shown
      ? topBar.current?.querySelector<HTMLElement>('[role="alert"]')
      : null;
    const element = canvas.current;
    const measure = () =>
      setOverlap(
        notice && element
          ? noticeOverlap(
              notice.getBoundingClientRect(),
              element.getBoundingClientRect(),
            )
          : 0,
      );
    measure();
    if (!notice || !element) {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(notice);
    observer.observe(element);
    return () => observer.disconnect();
  }, [topBar, canvas, shown]);
  return overlap;
};
/** The canvas size, tracked with a `ResizeObserver`. */
export const useSize = (): {
  ref: RefObject<HTMLDivElement | null>;
  size: { width: number; height: number };
} => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(
      ([entry]) =>
        entry &&
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
};
