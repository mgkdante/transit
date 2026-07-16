/**
 * Short loads should resolve without flashing a placeholder. Once this grace
 * period elapses, the shared EdgeState skeleton becomes visible and announces
 * the still-running load.
 */
export const DEFAULT_LOADING_SKELETON_DELAY_MS = 240;
