import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// The Mongo driver is server-only; keep it out of any client bundle.
	serverExternalPackages: ["mongodb"],

	// Lets the e2e run own its own build output. Sharing `.next` with a dev server the operator
	// already has open makes both hang; Playwright sets this to `.next-e2e`.
	distDir: process.env.NEXT_DIST_DIR || ".next",

	experimental: {
		// TypeScript 7 is the Go port and drops the JS compiler API Next reaches for by default;
		// without this the dev server boots, then hangs every request on an unhandled rejection.
		useTypeScriptCli: true,
	},
};

export default nextConfig;
