import { Channels, type Stop } from "./channels";
import { BAND_PAD, CARD_GAP, CORRIDOR, GUTTER } from "./layeredMetrics";
import { geometry as cardGeometry } from "./layout";
import {
  type ColumnRoute,
  type RelationshipRoute,
  type RouteBox,
  type RouteInput,
  type TableRoute,
} from "./routeTypes";

const RELATIONSHIP_LEFT = 12;
const RELATIONSHIP_WIDTH = 64;

/**
 * The channels that one run's edges are laid into, and the ports, lanes and gutters they leave through.
 * Channels are created in call order, and the optimiser walks them in that order.
 */
export class GutterPlan {
  readonly channels = new Channels();
  private readonly input: RouteInput;
  private readonly ids: string[];
  private readonly rowCount: number;
  private readonly rowBounds: { top: number; bottom: number }[];
  private readonly focus: string;
  private readonly focusCentre: number;
  private readonly focusRow: number;
  private readonly corridor: string;
  private readonly outerLeft: string;
  private readonly outerRight: string;

  constructor(input: RouteInput) {
    this.input = input;
    this.ids = [...input.boxes.keys()];
    this.rowCount = Math.max(0, ...input.rowOf.values()) + 1;
    this.rowBounds = Array.from({ length: this.rowCount }, (_, index) =>
      rowExtent(
        this.ids
          .filter((id) => this.rowIndex(id) === index)
          .map((id) => this.boxOf(id)),
      ),
    );
    this.focus = input.focus;
    const focusBox = this.boxOf(input.focus);
    this.focusCentre = focusBox.x + focusBox.width / 2;
    this.focusRow = this.rowIndex(input.focus);
    const { layeredBounds } = input;
    this.corridor = this.channels.channel(
      "corridor",
      this.focusCentre - CORRIDOR / 2 + 8,
      this.focusCentre + CORRIDOR / 2 - 8,
    );
    this.outerLeft = this.channels.channel(
      "outerL",
      layeredBounds.left - BAND_PAD - GUTTER + 6,
      layeredBounds.left - BAND_PAD - 6,
    );
    this.outerRight = this.channels.channel(
      "outerR",
      layeredBounds.right + BAND_PAD + 6,
      layeredBounds.right + BAND_PAD + GUTTER - 6,
    );
  }

  private boxOf(id: string): RouteBox {
    return this.input.boxes.get(id) ?? { x: 0, y: 0, width: 0, height: 0 };
  }

  private rowIndex(id: string): number {
    return this.input.rowOf.get(id) ?? 0;
  }

  // Gutter i runs between row i and row i + 1, clear of the bubbles that stick out of the cards.
  private gutter(index: number): string {
    const [lo, hi] = gutterBounds(this.rowBounds, index);
    return this.channels.channel(`h${index}`, lo, hi);
  }

  // A card's bubble channel is the bubble's width, centred on the card, so table edges meet the bubble.
  // The start node's bubbles share the corridor.
  private port(id: string, side: "t" | "b"): { name: string; y: number } {
    const box = this.boxOf(id);
    const y = side === "t" ? box.y : box.y + box.height;
    if (id === this.focus) {
      return { name: this.corridor, y };
    }
    const centre = box.x + box.width / 2;
    const half = cardGeometry.bubbleWidth / 2;
    const name = this.channels.channel(
      `p${id}${side}`,
      centre - half,
      centre + half,
    );
    return { name, y };
  }

  private lane(id: string, side: "l" | "r"): string {
    const box = this.boxOf(id);
    if (side === "r") {
      return this.channels.channel(
        `l${id}r`,
        box.x + box.width + 16,
        box.x + box.width + CARD_GAP - 6,
      );
    }
    return this.channels.channel(`l${id}l`, box.x - CARD_GAP + 6, box.x - 16);
  }

  // The vertical channel for a span: the corridor when no card between the two rows sits over it; else the clear
  // gap between those cards nearest `targetX`; else the outer channel on `targetX`'s side. A span past the start
  // node's row always takes the outer channel.
  private spine(first: number, second: number, targetX: number): string {
    const outer = targetX < this.focusCentre ? this.outerLeft : this.outerRight;
    const lo = Math.min(first, second);
    const hi = Math.max(first, second);
    if (this.focusRow > lo && this.focusRow < hi) {
      return outer;
    }
    if (this.clearIn(this.corridor, { first: lo, last: hi }, 0)) {
      return this.corridor;
    }
    return this.gapChannel(lo, hi, targetX) ?? outer;
  }

  /**
   * A channel through the widest-enough clear x range between the cards of rows strictly between `first` and
   * `second`, within the layered cards' extent, choosing the one nearest `targetX`. `undefined` when there is none.
   */
  private gapChannel(
    first: number,
    second: number,
    targetX: number,
  ): string | undefined {
    const margin = 16;
    const blocked = this.ids
      .filter((id) => this.rowIndex(id) > first && this.rowIndex(id) < second)
      .map((id) => this.boxOf(id))
      .map((box) => [box.x - margin, box.x + box.width + margin] as const)
      .sort(([a], [b]) => a - b);
    const { left, right } = this.input.layeredBounds;
    const gaps: [number, number][] = [];
    let from = left;
    for (const [start, end] of blocked) {
      if (start > from) {
        gaps.push([from, start]);
      }
      from = Math.max(from, end);
    }
    if (right > from) {
      gaps.push([from, right]);
    }
    const nearest = gaps
      .filter(([a, b]) => b - a >= 12)
      .sort(
        ([a1, b1], [a2, b2]) =>
          Math.abs((a1 + b1) / 2 - targetX) - Math.abs((a2 + b2) / 2 - targetX),
      )[0];
    if (!nearest) {
      return undefined;
    }
    const [a, b] = nearest;
    return this.channels.channel(`gap${first}-${second}:${a}`, a, b);
  }

  private relationshipPort(
    id: string,
    side: "t" | "b",
  ): { name: string; y: number } {
    const box = this.boxOf(id);
    const y = side === "t" ? box.y : box.y + box.height;
    const name = this.channels.channel(
      `q${id}${side}`,
      box.x + RELATIONSHIP_LEFT,
      box.x + Math.min(RELATIONSHIP_WIDTH, box.width * 0.3),
    );
    return { name, y };
  }

  // A span is clear in a channel when no card in the rows strictly between `rows.first` and `rows.last` comes
  // within `margin` of the channel's x range.
  private clearIn(
    name: string,
    rows: { first: number; last: number },
    margin = 10,
  ): boolean {
    const { lo, hi } = this.channels.bounds(name);
    return this.ids.every((id) => {
      const box = this.boxOf(id);
      const outside =
        this.rowIndex(id) <= rows.first || this.rowIndex(id) >= rows.last;
      return outside || box.x + box.width + margin < lo || box.x - margin > hi;
    });
  }

  // Table edges: a one-generation step that clears the cards drops straight; a longer span takes the spine.
  addTableRoute(edge: TableRoute): void {
    const { boxes, generation } = this.input;
    const first = this.rowIndex(edge.parent);
    const second = this.rowIndex(edge.child);
    // Edges point down the rows, and sub-rows never merge across an edge, so a parent is always above its child.
    if (first >= second || !boxes.has(edge.parent) || !boxes.has(edge.child)) {
      return;
    }
    const start = this.port(edge.parent, "b");
    const end = this.port(edge.child, "t");
    const g1 = this.gutter(first);
    const g2 = this.gutter(second - 1);
    const direct =
      second - first > 1 &&
      Math.abs(
        (generation.get(edge.child) ?? 0) - (generation.get(edge.parent) ?? 0),
      ) === 1;
    let stops: Stop[];
    const child = this.boxOf(edge.child);
    const childCentre = child.x + child.width / 2;
    if (direct && this.clearIn(end.name, { first, last: second })) {
      stops = [
        [start.name, start.y],
        [start.name, g1],
        [end.name, g1],
        [end.name, end.y],
      ];
    } else if (direct && this.clearIn(start.name, { first, last: second })) {
      stops = [
        [start.name, start.y],
        [start.name, g2],
        [end.name, g2],
        [end.name, end.y],
      ];
    } else {
      stops = [
        [start.name, start.y],
        [start.name, g1],
      ];
      if (second - first > 1) {
        const sp = this.spine(first, second, childCentre);
        stops.push([sp, g1], [sp, g2]);
      }
      stops.push([end.name, g2], [end.name, end.y]);
    }
    this.channels.add(
      { id: edge.id, kind: "table", other: childCentre },
      stops,
    );
  }

  // Declared relationships: from the upper card down to the lower one; cards in one row join through the gutter.
  addRelationshipRoute(relationship: RelationshipRoute): void {
    const { boxes } = this.input;
    if (!boxes.has(relationship.from) || !boxes.has(relationship.to)) {
      return;
    }
    const upperFirst =
      this.rowIndex(relationship.from) <= this.rowIndex(relationship.to);
    const upper = upperFirst ? relationship.from : relationship.to;
    const lower = upperFirst ? relationship.to : relationship.from;
    const iu = this.rowIndex(upper);
    const il = this.rowIndex(lower);
    const stops =
      iu === il
        ? this.sameRowStops(upper, lower, iu)
        : this.spanStops({ upper, lower, iu, il });
    this.channels.add(
      {
        id: relationship.id,
        kind: "rel",
        other: this.boxOf(lower).x,
        startsAt: upper,
      },
      stops,
    );
  }

  private sameRowStops(upper: string, lower: string, iu: number): Stop[] {
    const below = iu < this.rowCount - 1;
    const side = below ? "b" : "t";
    const g = below ? this.gutter(iu) : this.gutter(iu - 1);
    const pa = this.relationshipPort(upper, side);
    const pb = this.relationshipPort(lower, side);
    return [
      [pa.name, pa.y],
      [pa.name, g],
      [pb.name, g],
      [pb.name, pb.y],
    ];
  }

  private spanStops({
    upper,
    lower,
    iu,
    il,
  }: {
    upper: string;
    lower: string;
    iu: number;
    il: number;
  }): Stop[] {
    const ps = this.relationshipPort(upper, "b");
    const pe = this.relationshipPort(lower, "t");
    const g1 = this.gutter(iu);
    const g2 = this.gutter(il - 1);
    if (il - iu === 1 || this.clearIn(pe.name, { first: iu, last: il })) {
      return [
        [ps.name, ps.y],
        [ps.name, g1],
        [pe.name, g1],
        [pe.name, pe.y],
      ];
    }
    if (this.clearIn(ps.name, { first: iu, last: il })) {
      return [
        [ps.name, ps.y],
        [ps.name, g2],
        [pe.name, g2],
        [pe.name, pe.y],
      ];
    }
    const sp = this.spine(iu, il, this.boxOf(lower).x);
    return [
      [ps.name, ps.y],
      [ps.name, g1],
      [sp, g1],
      [sp, g2],
      [pe.name, g2],
      [pe.name, pe.y],
    ];
  }

  // Column edges leave the source card on the right, run down a side lane, and enter the target on the left.
  addColumnRoute(column: ColumnRoute): void {
    const { boxes } = this.input;
    const from = this.boxOf(column.from);
    const to = this.boxOf(column.to);
    const ia = this.rowIndex(column.from);
    const ib = this.rowIndex(column.to);
    if (ia > ib || !boxes.has(column.from) || !boxes.has(column.to)) {
      return;
    }
    const s = { x: from.x + from.width, y: column.fromY };
    const e = { x: to.x, y: column.toY };
    const lr = this.lane(column.from, "r");
    const ll = this.lane(column.to, "l");
    const stops: Stop[] = [[s.x, s.y]];
    if (ia === ib) {
      const g = this.gutter(ia);
      stops.push([lr, s.y], [lr, g], [ll, g], [ll, e.y]);
    } else {
      const g1 = this.gutter(ia);
      const g2 = this.gutter(ib - 1);
      stops.push([lr, s.y], [lr, g1]);
      if (ib - ia > 1) {
        const sp = this.spine(ia, ib, e.x);
        stops.push([sp, g1], [sp, g2]);
      }
      stops.push([ll, g2], [ll, e.y]);
    }
    stops.push([e.x, e.y]);
    this.channels.add({ id: column.id, kind: "col", other: e.x }, stops);
  }
}

/** The vertical extent of one row's cards. An empty row has no extent. */
function rowExtent(members: readonly RouteBox[]): {
  top: number;
  bottom: number;
} {
  if (members.length === 0) {
    return { top: 0, bottom: 0 };
  }
  return {
    top: Math.min(...members.map((box) => box.y)),
    bottom: Math.max(...members.map((box) => box.y + box.height)),
  };
}

/** The span a gutter between row `index` and the row below it may use, clear of the cards on either side. */
function gutterBounds(
  rowBounds: readonly { top: number; bottom: number }[],
  index: number,
): [number, number] {
  const upper = rowBounds[index];
  const lower = rowBounds[index + 1];
  if (upper && lower) {
    return [upper.bottom + 18, lower.top - 20];
  }
  if (upper) {
    return [upper.bottom + 18, upper.bottom + 58];
  }
  if (lower) {
    return [lower.top - 58, lower.top - 20];
  }
  return [0, 40];
}
