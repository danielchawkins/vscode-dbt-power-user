/** Whether a click on a card's control also selects the card: `true` selects it, `false` leaves the selection as it was. */
export const CONTROL_CLICK_SELECTS_CARD = true;

/** Whether `target` is inside a card's control, which the card marks with a `data-card-control` attribute. */
export const isCardControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest("[data-card-control]") !== null;
