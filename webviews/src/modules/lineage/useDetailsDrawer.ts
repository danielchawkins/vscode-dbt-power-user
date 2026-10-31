import type { DrawerRef } from "@uicore";
import { type RefObject, useCallback, useState } from "react";

/**
 * The table the details drawer shows, and `openDetails`, which sets it and opens the drawer. Both are needed before the
 * graph is built, because the graph's cards call `openDetails`.
 */
export const useDetailsDrawer = (
  drawerRef: RefObject<DrawerRef | null>,
): {
  detailsTable: string | undefined;
  openDetails: (table: string) => void;
} => {
  const [detailsTable, setDetailsTable] = useState<string>();
  const openDetails = useCallback(
    (table: string) => {
      setDetailsTable(table);
      drawerRef.current?.open();
    },
    [drawerRef],
  );
  return { detailsTable, openDetails };
};
