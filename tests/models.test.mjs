import { expect, test } from "vitest";

import { contextWindow } from "../src/parser/models.mjs";

test("resolves the context window for a model string carrying a [1m] suffix", () => {
	// The live session reports its model as e.g. `claude-opus-5[1m]`.
	expect(contextWindow("claude-opus-5[1m]")).toBe(1_000_000);
	expect(contextWindow("claude-haiku-4-5")).toBe(200_000);
});

test("resolves the context window for a model string carrying a dated suffix", () => {
	// Some records identify the model by release date, e.g. `claude-haiku-4-5-20251001`.
	expect(contextWindow("claude-haiku-4-5-20251001")).toBe(200_000);
});

test("knows the 1M context window of Opus 5.5 and Fable 5.1, so their context use is never 0%", () => {
	expect(contextWindow("claude-opus-5-5[1m]")).toBe(1_000_000);
	expect(contextWindow("claude-fable-5-1")).toBe(1_000_000);
});

