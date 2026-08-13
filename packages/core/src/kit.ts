import { createLowlight, common } from 'lowlight';
import { createUltraKitWithLowlight, type UltraKitOptions } from './kit-base';

export type { UltraKitAIOptions, UltraKitOptions } from './kit-base';

/** Full preset with lowlight's common language catalogue. */
export function createUltraKit(options: UltraKitOptions = {}) {
  return createUltraKitWithLowlight(options, () => createLowlight(common));
}
