import { describe, expect, it } from "vitest";
import { holdLive, isTyping, liveHeld } from "./hold";

describe("quando a atualização ao vivo espera", () => {
  it("segura enquanto houver alguém segurando", () => {
    expect(liveHeld()).toBe(false);
    const a = holdLive();
    const b = holdLive();
    a();
    a();
    expect(liveHeld()).toBe(true);
    b();
    expect(liveHeld()).toBe(false);
  });

  it("conta como digitação só campo de texto", () => {
    expect(isTyping(null)).toBe(false);
    expect(isTyping({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTyping({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTyping({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTyping({ tagName: "input", type: "" })).toBe(true);
    expect(isTyping({ tagName: "INPUT", type: "date" })).toBe(true);
    expect(isTyping({ tagName: "INPUT", type: "search" })).toBe(false);
    expect(isTyping({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTyping({ tagName: "SELECT" })).toBe(false);
    expect(isTyping({ tagName: "BUTTON" })).toBe(false);
  });
});
