import { conflict } from "../../lib/errors.js";

export function requiredString(value: unknown, min: number, max: number) {
  if (typeof value !== "string") throw conflict("A required value is missing");
  const result = value.trim();
  if (result.length < min || result.length > max) throw conflict("A value has an invalid length");
  return result;
}

export function optionalString(value: unknown, max: number) {
  if (value === undefined || value === null || value === "") return "";
  return requiredString(value, 1, max);
}

export function requiredNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw conflict("A numeric value is outside the allowed range");
  return value;
}

export function optionalInteger(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw conflict("A year is outside the allowed range");
  return value;
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

export function requiredId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw conflict("A valid item ID is required");
  return value;
}

export function attachmentIdsFrom(payload: Record<string, unknown>, min: number, max: number) {
  const ids = Array.isArray(payload.attachmentIds) ? payload.attachmentIds : [];
  if (ids.length < min || ids.length > max || ids.some((id) => typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) || new Set(ids).size !== ids.length) throw conflict("Select the required number of valid attachments");
  return ids as string[];
}
