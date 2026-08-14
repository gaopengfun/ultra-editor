declare const __ULTRA_EDITOR_VERSION__: string;

let resolvedVersion = '0.0.0-dev';
/* v8 ignore else -- only Vite's unbundled /@fs source mode omits this constant */
if (typeof __ULTRA_EDITOR_VERSION__ !== 'undefined') {
  resolvedVersion = __ULTRA_EDITOR_VERSION__;
}

export const VERSION = resolvedVersion;
