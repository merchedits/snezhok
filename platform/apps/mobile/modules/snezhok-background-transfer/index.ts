import { requireOptionalNativeModule } from "expo-modules-core";

export type NativeTransferStatus = "staging" | "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled";

export interface NativeTransferSnapshot {
  transferId: string;
  uploadId: string;
  status: NativeTransferStatus;
  uploadedBytes: number;
  totalBytes: number;
  progress: number;
  attempt: number;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  allowMetered: boolean;
  resultJson: string | null;
}

export interface NativeTransferInput {
  transferId: string;
  uploadId: string;
  apiBaseUrl: string;
  capability: string;
  sourceUri: string;
  declaredBytes: number;
  chunkBytes: number;
  expiresAt: number;
  allowMetered: boolean;
  createdAt?: number;
}

interface Subscription { remove(): void }

interface SnezhokBackgroundTransferNativeModule {
  enqueueTransfer(input: NativeTransferInput): Promise<NativeTransferSnapshot>;
  listTransfers(): Promise<NativeTransferSnapshot[]>;
  getTransfer(transferId: string): Promise<NativeTransferSnapshot | null>;
  cancelTransfer(transferId: string): Promise<NativeTransferSnapshot | null>;
  resumeTransfer(transferId: string, sourceUri: string | null): Promise<NativeTransferSnapshot | null>;
  retryTransfer(transferId: string): Promise<NativeTransferSnapshot | null>;
  removeTransfer(transferId: string): Promise<boolean>;
  addListener(eventName: "onTransferChanged", listener: (snapshot: NativeTransferSnapshot) => void): Subscription;
}

const nativeModule = requireOptionalNativeModule<SnezhokBackgroundTransferNativeModule>("SnezhokBackgroundTransfer");

export const backgroundTransferAvailable = nativeModule !== null;

export function enqueueNativeTransfer(input: NativeTransferInput): Promise<NativeTransferSnapshot> {
  if (!nativeModule) return Promise.reject(new Error("Background transfers are unavailable in this build"));
  return nativeModule.enqueueTransfer(input);
}

export async function listNativeTransfers(): Promise<NativeTransferSnapshot[]> {
  return nativeModule?.listTransfers() ?? [];
}

export async function nativeTransfer(transferId: string): Promise<NativeTransferSnapshot | null> {
  return nativeModule?.getTransfer(transferId) ?? null;
}

export async function cancelNativeTransfer(transferId: string): Promise<NativeTransferSnapshot | null> {
  return nativeModule?.cancelTransfer(transferId) ?? null;
}

export async function resumeNativeTransfer(transferId: string, sourceUri: string | null): Promise<NativeTransferSnapshot | null> {
  return nativeModule?.resumeTransfer(transferId, sourceUri) ?? null;
}

export async function retryNativeTransfer(transferId: string): Promise<NativeTransferSnapshot | null> {
  return nativeModule?.retryTransfer(transferId) ?? null;
}

export async function removeNativeTransfer(transferId: string): Promise<boolean> {
  return nativeModule?.removeTransfer(transferId) ?? false;
}

export function addNativeTransferListener(listener: (snapshot: NativeTransferSnapshot) => void): Subscription {
  return nativeModule?.addListener("onTransferChanged", listener) ?? { remove() {} };
}
