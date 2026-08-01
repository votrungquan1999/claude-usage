import assert from "node:assert/strict";
import { test } from "node:test";

import { contextWindow } from "../src/parser/models.mjs";

test("resolves the context window for a model string carrying a [1m] suffix", () => {
	// The live session reports its model as e.g. `claude-opus-5[1m]`.
	assert.equal(contextWindow("claude-opus-5[1m]"), 1_000_000);
	assert.equal(contextWindow("claude-haiku-4-5"), 200_000);
});
