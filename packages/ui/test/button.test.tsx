import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../src";

describe("Button", () => {
  it("preserves native button behavior and custom classes", () => {
    const onClick = vi.fn();
    render(
      <Button className="publish" onClick={onClick} type="button">
        发布
      </Button>,
    );

    const button = screen.getByRole("button", { name: "发布" });
    expect(button).toHaveClass("socal-button", "publish");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
