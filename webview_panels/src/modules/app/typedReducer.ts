/** One action per key of the payload map `P`. */
export type ReducerAction<P> = {
  [K in keyof P]: { type: K; payload: P[K] };
}[keyof P];

/** One pure state transition per action type of `P`. */
export type ReducerHandlers<S, P> = {
  [K in keyof P]: (state: S, payload: P[K]) => S;
};

/** A `useReducer` reducer over `handlers`, and one action creator per handler. An unknown action leaves state as is. */
export function typedReducer<S, P>(
  handlers: ReducerHandlers<S, P>,
): {
  reducer: (state: S, action: ReducerAction<P>) => S;
  actions: { [K in keyof P]: (payload: P[K]) => ReducerAction<P> };
} {
  const reducer = (state: S, action: ReducerAction<P>): S => {
    if (!Object.prototype.hasOwnProperty.call(handlers, action.type)) {
      return state;
    }
    const handler = handlers[action.type] as (state: S, payload: unknown) => S;
    return handler(state, action.payload);
  };
  const actions = Object.fromEntries(
    Object.keys(handlers).map((type) => [
      type,
      (payload: unknown) => ({ type, payload }),
    ]),
  ) as { [K in keyof P]: (payload: P[K]) => ReducerAction<P> };
  return { reducer, actions };
}
