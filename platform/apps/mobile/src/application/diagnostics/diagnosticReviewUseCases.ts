import type { DiagnosticHealth } from "@snezhok/contracts";

import { diagnosticReport, type DiagnosticReport } from "../../diagnostics/diagnostics";
import { api } from "../../infrastructure/http/apiClient";

export interface DiagnosticReview {
  report: DiagnosticReport;
  health: DiagnosticHealth;
}

export const diagnosticReviewUseCases = {
  load: async (language: "en" | "ru"): Promise<DiagnosticReview> => {
    const [report, health] = await Promise.all([diagnosticReport(language), api.diagnosticHealth()]);
    return { report, health };
  },
  localReport: (language: "en" | "ru") => diagnosticReport(language),
  submit: async (language: "en" | "ru") => api.sendDiagnosticReport(await diagnosticReport(language)),
};
