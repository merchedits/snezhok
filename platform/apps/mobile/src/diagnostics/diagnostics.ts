import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

import type { PerformanceBudget } from "./performanceBudgets";
import { appendBounded } from "./boundedRingBuffer";
import { evaluatePerformanceBudget } from "./performanceBudgets";
import { sanitizeDiagnosticContext, sanitizeDiagnosticValue } from "./redaction";

const EVENTS_KEY = "@snezhok/diagnostics/events/v1";
const INSTALLATION_KEY = "@snezhok/diagnostics/installation/v1";
const MAX_EVENTS = 200;
const PERSIST_DELAY_MS = 4_000;

export type DiagnosticLevel = "debug" | "info" | "warn" | "error";
export interface DiagnosticEvent {
  at: number;
  level: DiagnosticLevel;
  category: string;
  message: string;
  durationMs?: number;
  context?: Record<string, string | number | boolean | null>;
}

export interface DiagnosticReport {
  installationId: string;
  appVersion: string;
  versionCode: number;
  platform: "android";
  osVersion: string;
  device: string;
  locale: "ru" | "en";
  recordedAt: number;
  events: DiagnosticEvent[];
}

let events: DiagnosticEvent[] = [];
let installationId = "pending";
let initialized: Promise<void> | null = null;
let persistenceTimer: ReturnType<typeof setTimeout> | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();
let previousGlobalHandler: ((error: Error, isFatal?: boolean) => void) | undefined;

export function initializeDiagnostics(): Promise<void> {
  if (initialized) return initialized;
  initialized = (async () => {
    const [storedEvents, storedInstallationId] = await Promise.all([
      AsyncStorage.getItem(EVENTS_KEY),
      AsyncStorage.getItem(INSTALLATION_KEY),
    ]);
    events = parseEvents(storedEvents);
    installationId = storedInstallationId && storedInstallationId.length >= 8 ? storedInstallationId : Crypto.randomUUID();
    if (!storedInstallationId) await AsyncStorage.setItem(INSTALLATION_KEY, installationId);
    recordDiagnostic("info", "lifecycle", "Application diagnostics initialized", {
      version: Application.nativeApplicationVersion ?? "unknown",
      build: Application.nativeBuildVersion ?? "0",
    });
  })();
  return initialized;
}

export function installGlobalErrorCapture(): () => void {
  const errorUtils = (globalThis as typeof globalThis & { ErrorUtils?: {
    getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void);
    setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
  } }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return () => undefined;
  previousGlobalHandler = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    recordDiagnostic("error", "crash", isFatal ? "Fatal JavaScript error" : "Unhandled JavaScript error", {
      name: error.name,
      fatal: Boolean(isFatal),
    });
    previousGlobalHandler?.(error, isFatal);
  });
  return () => {
    if (previousGlobalHandler) errorUtils.setGlobalHandler?.(previousGlobalHandler);
  };
}

export function recordDiagnostic(
  level: DiagnosticLevel,
  category: string,
  message: string,
  context?: Record<string, unknown>,
  durationMs?: number,
): void {
  const event: DiagnosticEvent = {
    at: Date.now(),
    level,
    category: sanitizeText(category, 48),
    message: sanitizeText(message, 240),
    ...(durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(durationMs * 10) / 10) }),
    ...(context ? { context: sanitizeDiagnosticContext(context) } : {}),
  };
  appendBounded(events, event, MAX_EVENTS);
  schedulePersistence(level === "error");
}

export function recordPerformance(name: PerformanceBudget, durationMs: number, context?: Record<string, unknown>): void {
  const result = evaluatePerformanceBudget(name, durationMs);
  recordDiagnostic(result.passed ? "info" : "warn", "performance", name, { ...context, budgetMs: result.budgetMs, passed: result.passed }, durationMs);
}

export async function diagnosticReport(locale: "ru" | "en"): Promise<DiagnosticReport> {
  await initializeDiagnostics();
  return {
    installationId,
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "unknown",
    versionCode: Number(Application.nativeBuildVersion ?? 0),
    platform: "android",
    osVersion: String(Platform.Version),
    device: sanitizeText(Constants.deviceName ?? "Android device", 80),
    locale,
    recordedAt: Date.now(),
    events: events.slice(),
  };
}

export async function clearDiagnostics(): Promise<void> {
  events = [];
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = null;
  persistenceQueue = persistenceQueue
    .catch(() => undefined)
    .then(() => AsyncStorage.removeItem(EVENTS_KEY))
    .catch(() => undefined);
  await persistenceQueue;
}

function sanitizeText(value: string, maxLength: number): string {
  return sanitizeDiagnosticValue(value).replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength) || "unknown";
}

function parseEvents(value: string | null): DiagnosticEvent[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((event): event is DiagnosticEvent => Boolean(event && typeof event === "object" && typeof (event as DiagnosticEvent).at === "number" && typeof (event as DiagnosticEvent).message === "string")).slice(-MAX_EVENTS);
  } catch {
    return [];
  }
}

function schedulePersistence(urgent = false): void {
  if (persistenceTimer && !urgent) return;
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    persistenceTimer = null;
    const snapshot = JSON.stringify(events);
    persistenceQueue = persistenceQueue
      .catch(() => undefined)
      .then(() => AsyncStorage.setItem(EVENTS_KEY, snapshot))
      .catch(() => undefined);
  }, urgent ? 0 : PERSIST_DELAY_MS);
}
