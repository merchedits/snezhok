export const INACTIVE_GAME_TTL_MS = 24 * 60 * 60_000;
export const EXPIRING_GAME_TYPES = ["tic-tac-toe", "chess", "checkers", "sea-battle", "pool"] as const;

export function inactiveGameCutoff(now = Date.now()): Date {
  return new Date(now - INACTIVE_GAME_TTL_MS);
}
