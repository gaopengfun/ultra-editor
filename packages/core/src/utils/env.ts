/** SSR guard — every DOM touch in the SDK goes through this. */
export const isBrowser = (): boolean =>
  typeof window !== 'undefined' && typeof document !== 'undefined';
