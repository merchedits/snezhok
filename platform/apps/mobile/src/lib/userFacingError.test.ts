import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "./apiError";
import { userFacingError } from "./userFacingError";

test("server errors are presented in the selected language", () => {
  const error = new ApiError("Profile photo must be an image uploaded by this account", 403, "FORBIDDEN");
  assert.equal(userFacingError(error, (key) => key === "actionNotAllowed" ? "Это действие недоступно для вашего аккаунта." : key), "Это действие недоступно для вашего аккаунта.");
  assert.equal(userFacingError(error, (key) => key === "actionNotAllowed" ? "This action is not available for your account." : key), "This action is not available for your account.");
});
