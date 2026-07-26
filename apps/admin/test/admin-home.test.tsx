import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AdminHome from "../src/app/page";

describe("AdminHome", () => {
  it("renders a semantic main workspace with operator actions", () => {
    render(<AdminHome />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
});
