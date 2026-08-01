#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { install } from "../src/install.mjs";

const repoRoot = dirname(import.meta.dirname);
const home = homedir();

install({ home, repoRoot });

console.log(`Linked ${repoRoot} -> ${join(home, ".claude", "claude-usage")}`);
console.log(`Status line wired into ${join(home, ".claude", "settings.json")} (previous version backed up).`);
console.log("Open a new Claude Code session in the terminal to see it.");
