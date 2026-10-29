// lint-expect: eslint no-restricted-syntax
declare const port: { postMessage(m: unknown): void };
export const send = () => port.postMessage(1);
