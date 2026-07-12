import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, Toggle, formatDay } from "./ui.js";

describe("shared UI primitives", () => {
  it("renders deterministic initials and presence semantics", () => {
    render(<Avatar name="Ada Lovelace" color="#123456" presence="online" />);
    expect(screen.getByLabelText("Ada Lovelace")).toHaveTextContent("AD");
    expect(screen.getByLabelText("online")).toBeInTheDocument();
  });

  it("exposes toggle state as an accessible switch", () => {
    render(<Toggle checked onChange={() => undefined} label="Read receipts" />);
    expect(screen.getByRole("switch", { name: "Read receipts" })).toHaveAttribute("aria-checked", "true");
  });

  it("uses a literal label for the current day", () => {
    expect(formatDay(Date.now())).toBe("Today");
  });
});
