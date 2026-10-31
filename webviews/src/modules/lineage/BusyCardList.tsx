import type { BusyControls } from "./busyCards";

/**
 * The busy-node list: each card with more connections than the threshold, ranked by degree, with its count and Hide,
 * Soften and Dim. Soften and Dim are toggles that stay pressed while set, so pressing again undoes them; Hide puts the
 * card in the hidden cards, where Restore brings it back.
 */
const BusyCardList = ({ busy }: { busy: BusyControls }): React.JSX.Element => (
  <section aria-label="Busy cards">
    <span>Busy cards</span>
    {busy.cards.length === 0 ? (
      <p>
        {busy.threshold > 0
          ? `No card has more than ${busy.threshold} connections.`
          : "No cap is set, so no card is busy."}
      </p>
    ) : (
      <ul>
        {busy.cards.map((card) => (
          <li key={card.id}>
            {card.label} <span>{card.degree} connections</span>{" "}
            {card.hideable ? (
              <button
                type="button"
                aria-label={`Hide ${card.label}`}
                onClick={() => busy.hide(card)}
              >
                Hide
              </button>
            ) : null}
            <button
              type="button"
              aria-label={`Soften ${card.label}`}
              aria-pressed={card.softened}
              disabled={!busy.ready}
              title="Keep the card, but its edges pull the layout weakly and rank nothing"
              onClick={() => busy.setSoftened(card.id, !card.softened)}
            >
              Soften
            </button>
            <button
              type="button"
              aria-label={`Dim ${card.label}`}
              aria-pressed={card.dimmed}
              disabled={!busy.ready}
              title="Draw the card and its edges faded"
              onClick={() => busy.setDimmed(card.id, !card.dimmed)}
            >
              Dim
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);

export default BusyCardList;
