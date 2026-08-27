import type { CooperativeActivity, CooperativeActivityType } from "@snezhok/contracts";

export interface ActivityCreateInput {
  clientId: string;
  type: CooperativeActivityType;
  options: Record<string, unknown>;
}

export interface ActivityCommandInput {
  clientId: string;
  expectedRevision: number;
  action: "submit" | "add-item" | "update-item" | "remove-item" | "rate" | "set-status" | "pick" | "reroll" | "confirm" | "submit-drawing" | "guess" | "complete" | "decline" | "cancel"
    | "game-move" | "game-ready" | "game-shuffle" | "game-rematch" | "game-resign";
  payload: Record<string, unknown>;
}

export interface ActivityRow {
  id: string;
  conversation_id: string;
  anchor_message_id: string | null;
  created_by: string;
  type: CooperativeActivityType;
  state: CooperativeActivity["state"];
  revision: string;
  config: Record<string, unknown>;
  result: Record<string, unknown> | null;
}

export interface EntryRow {
  id: string;
  created_by: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface ActionResult {
  state?: CooperativeActivity["state"];
  result?: Record<string, unknown>;
  revealAt?: Date;
  completed?: boolean;
  resetCompletedAt?: boolean;
}
