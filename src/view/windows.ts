/**
 * The shared window system (src/shared/windows.ts, a synced copy of
 * mono/shared/windows.ts) with this app's window kinds pinned.
 */

import type { Win as SharedWin, WindowManagerOptions as SharedWindowManagerOptions } from '../shared/windows.js';
import type { WindowKind } from '../settings.js';

export * from '../shared/windows.js';
export type Win = SharedWin<WindowKind>;
export type WindowManagerOptions = SharedWindowManagerOptions<WindowKind>;
