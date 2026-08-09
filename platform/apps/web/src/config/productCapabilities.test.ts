import { describe, expect, it } from "vitest";
import { isUserVisibleStreamKind, productCapabilities } from "./productCapabilities.js";

describe("product capabilities", () => {
  it("keeps servers dormant in the current web product", () => {
    expect(productCapabilities.servers).toBe(false);
    expect(isUserVisibleStreamKind("conversation")).toBe(true);
    expect(isUserVisibleStreamKind("channel")).toBe(false);
  });
});
