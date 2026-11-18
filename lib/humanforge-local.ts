/**
 * Narrow bridge to HumanForge's pinned runtime/canvas modules.
 * Avoid the upstream barrel exports: they also re-export optional selfie fitting.
 */
export { loadHumanPackage } from '../node_modules/humanforge/src/human/runtime';
export type { HumanAvatar, HumanPackage } from '../node_modules/humanforge/src/human/runtime';
export { HumanCanvas } from '../node_modules/humanforge/src/web/HumanCanvas';
export type { HumanCanvasHandle } from '../node_modules/humanforge/src/web/HumanCanvas';
