import AsyncStorage from "@react-native-async-storage/async-storage";

import { deliverPendingDiagnostics } from "../../application/diagnostics/diagnosticDelivery";
import { diagnosticReport } from "../../diagnostics/diagnostics";
import { api } from "../../infrastructure/http/apiClient";

const WATERMARK_KEY = "@snezhok/diagnostics/delivery-watermark/v1";
let activeDelivery: Promise<void> | null = null;

export function flushMobileDiagnostics(locale: "ru" | "en"): Promise<void> {
  if (activeDelivery) return activeDelivery;
  activeDelivery = deliverPendingDiagnostics({
    readWatermark: async () => Number(await AsyncStorage.getItem(WATERMARK_KEY)) || 0,
    writeWatermark: async (timestamp) => { await AsyncStorage.setItem(WATERMARK_KEY, String(timestamp)); },
    buildReport: (afterExclusive) => diagnosticReport(locale, afterExclusive),
    sendReport: async (report) => { await api.sendDiagnosticReport(report); },
  }).then(() => undefined).finally(() => { activeDelivery = null; });
  return activeDelivery;
}
