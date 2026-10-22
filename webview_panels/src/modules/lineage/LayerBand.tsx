import type { NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { BandNode } from "./flow";
import styles from "./lineageGraph.module.css";

/** A layer band behind the cards: a washed rectangle with its layer's name. It takes no pointer events. */
const LayerBandView = ({ data }: NodeProps<BandNode>): React.JSX.Element => (
  <div
    className={styles.band}
    style={{ "--band-colour": data.colour } as React.CSSProperties}
    data-layer={data.tag}
  >
    <span className={styles.bandLabel}>{data.tag}</span>
  </div>
);

export const LayerBand = memo(LayerBandView);
