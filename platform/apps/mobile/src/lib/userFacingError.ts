import type { TranslationKey } from "../i18n";
import { ApiError } from "./apiError";

type Translate = (key: TranslationKey) => string;

/** API and native error details are logged, never leaked as English UI copy. */
export function userFacingError(error: unknown, t: Translate, fallback: TranslationKey = "tryAgain"): string {
  if (error instanceof ApiError) {
    if (error.code === "VALIDATION_ERROR") return t("requestValidationFailed");
    if (error.code === "UNAUTHORIZED") return t("sessionExpired");
    if (error.code === "FORBIDDEN") return t("actionNotAllowed");
    if (error.code === "CONFLICT") return t("conflictTryAgain");
    if (error.code === "NOT_FOUND") return t("itemNotFound");
    if (error.status >= 500) return t("serverUnavailable");
    return t(fallback);
  }
  if (error instanceof TypeError) return t("networkUnavailable");
  return t(fallback);
}
