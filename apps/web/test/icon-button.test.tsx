import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { House } from "lucide-react";
import { describe, expect, it } from "vitest";
import { IconButton } from "../src/components/icons/icon-button";

describe("IconButton", () => {
  it("exposes a named link and its notification count", () => {
    render(<IconButton href="/zh-Hans" icon={House} label="首页" badge={2} />);

    expect(screen.getByRole("link", { name: "首页" })).toHaveAttribute("href", "/zh-Hans");
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
