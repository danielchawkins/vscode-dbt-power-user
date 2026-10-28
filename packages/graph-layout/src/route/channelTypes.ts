/** One member edge's run through a band, with in-rank coordinates at its ends. */
export interface ChannelPiece {
  /** In-rank coordinate of the upper end. */
  from: number;
  /** In-rank coordinate of the other end. */
  to: number;
  /**
   * Both ends sit on the upper edge of the band, as for a flat edge routed beneath its rank. Otherwise the lower end
   * sits on the band's lower edge.
   */
  flat: boolean;
  /** The source port the edge leaves from. Runs with one trunk are one bundle and never count as crossing. */
  trunk?: string | undefined;
}

/** Pieces that leave or enter one point, and the span of the track they need. */
export interface Hyperedge {
  members: number[];
  lo: number;
  hi: number;
  track: number;
}
