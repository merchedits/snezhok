import { assertTurn, baseState, completeGame, opponent } from "./common.js";
import type { PlayerPair, SeaBattlePrivateState, SeaBattleShot, SeaBattleState } from "./types.js";

export const SEA_BATTLE_FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1] as const;

export function createSeaBattle(players: PlayerPair, round = 1, scores?: Record<string, number>): SeaBattleState {
  return {
    ...baseState("sea-battle", players, round, scores),
    kind: "sea-battle",
    status: "setup",
    turnUserId: null,
    readyUserIds: [],
    shots: { [players[0]]: [], [players[1]]: [] },
  };
}

export function createSeaBattlePrivateState(random: () => number = Math.random): SeaBattlePrivateState {
  return { fleet: generateFleet(random) };
}

export function readySeaBattle(state: SeaBattleState, userId: string, fleet: number[][]): SeaBattleState {
  requirePlayer(state, userId);
  if (state.status !== "setup") throw new Error("The fleet is already locked");
  if (!validateFleet(fleet)) throw new Error("The fleet layout is invalid");
  const readyUserIds = [...new Set([...state.readyUserIds, userId])];
  if (readyUserIds.length < 2) return { ...state, readyUserIds, lastActionAt: 0 };
  return { ...state, readyUserIds, status: "playing", turnUserId: state.players[0], lastActionAt: 0 };
}

export function fireSeaBattle(
  state: SeaBattleState,
  userId: string,
  cell: number,
  fleets: Record<string, number[][]>,
): SeaBattleState {
  assertTurn(state, userId);
  if (!Number.isInteger(cell) || cell < 0 || cell >= 100) throw new Error("Choose a square on the board");
  const previous = state.shots[userId] ?? [];
  if (previous.some((shot) => shot.cell === cell)) throw new Error("That square was already fired at");
  const targetId = opponent(state, userId);
  const targetFleet = fleets[targetId];
  if (!targetFleet || !validateFleet(targetFleet)) throw new Error("The opponent's fleet is unavailable");
  const ship = targetFleet.find((candidate) => candidate.includes(cell));
  let shot: SeaBattleShot = { cell, outcome: ship ? "hit" : "miss" };
  if (ship) {
    const hitCells = new Set([...previous.filter((candidate) => candidate.outcome !== "miss").map((candidate) => candidate.cell), cell]);
    if (ship.every((candidate) => hitCells.has(candidate))) shot = { cell, outcome: "sunk", sunkCells: [...ship] };
  }
  const shots = { ...state.shots, [userId]: [...previous, shot] };
  const next = { ...state, shots, lastActionAt: 0 };
  const hitCount = new Set(shots[userId]!.filter((candidate) => candidate.outcome !== "miss").map((candidate) => candidate.cell)).size;
  if (hitCount === 20) return completeGame({ ...next, revealedFleets: cloneFleets(fleets) }, userId);
  return { ...next, turnUserId: ship ? userId : targetId };
}

export function generateFleet(random: () => number = Math.random): number[][] {
  for (let restart = 0; restart < 400; restart += 1) {
    const fleet: number[][] = [];
    let failed = false;
    for (const length of SEA_BATTLE_FLEET) {
      let placed = false;
      for (let attempt = 0; attempt < 300 && !placed; attempt += 1) {
        const horizontal = random() >= 0.5;
        const row = Math.floor(random() * (horizontal ? 10 : 11 - length));
        const column = Math.floor(random() * (horizontal ? 11 - length : 10));
        const ship = Array.from({ length }, (_, offset) => (row + (horizontal ? 0 : offset)) * 10 + column + (horizontal ? offset : 0));
        if (canPlace(ship, fleet)) {
          fleet.push(ship);
          placed = true;
        }
      }
      if (!placed) { failed = true; break; }
    }
    if (!failed && validateFleet(fleet)) return fleet;
  }
  throw new Error("Could not generate a valid fleet");
}

export function validateFleet(fleet: number[][]): boolean {
  if (!Array.isArray(fleet) || fleet.length !== SEA_BATTLE_FLEET.length) return false;
  const lengths = fleet.map((ship) => ship.length).sort((a, b) => b - a);
  if (lengths.some((length, index) => length !== SEA_BATTLE_FLEET[index])) return false;
  const occupied = new Set<number>();
  for (const ship of fleet) {
    if (!Array.isArray(ship) || new Set(ship).size !== ship.length || ship.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= 100)) return false;
    const rows = ship.map((cell) => Math.floor(cell / 10));
    const columns = ship.map((cell) => cell % 10);
    const straight = new Set(rows).size === 1 || new Set(columns).size === 1;
    const ordered = [...ship].sort((a, b) => a - b);
    const step = new Set(rows).size === 1 ? 1 : 10;
    if (!straight || ordered.some((cell, index) => index > 0 && cell - ordered[index - 1]! !== step)) return false;
    for (const cell of ship) {
      if (occupied.has(cell)) return false;
      occupied.add(cell);
    }
  }
  for (const cell of occupied) {
    const row = Math.floor(cell / 10);
    const column = cell % 10;
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const neighborRow = row + dr;
      const neighborColumn = column + dc;
      if (neighborRow < 0 || neighborRow > 9 || neighborColumn < 0 || neighborColumn > 9) continue;
      const neighbor = neighborRow * 10 + neighborColumn;
      if (occupied.has(neighbor) && !fleet.some((ship) => ship.includes(cell) && ship.includes(neighbor))) return false;
    }
  }
  return occupied.size === 20;
}

function canPlace(ship: number[], fleet: number[][]): boolean {
  const occupied = new Set(fleet.flat());
  return ship.every((cell) => {
    const row = Math.floor(cell / 10);
    const column = cell % 10;
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      const nearRow = row + dr;
      const nearColumn = column + dc;
      if (nearRow >= 0 && nearRow < 10 && nearColumn >= 0 && nearColumn < 10 && occupied.has(nearRow * 10 + nearColumn)) return false;
    }
    return true;
  });
}

function cloneFleets(fleets: Record<string, number[][]>): Record<string, number[][]> {
  return Object.fromEntries(Object.entries(fleets).map(([userId, fleet]) => [userId, fleet.map((ship) => [...ship])]));
}

function requirePlayer(state: SeaBattleState, userId: string) {
  if (!state.players.includes(userId)) throw new Error("Player is not part of this game");
}
