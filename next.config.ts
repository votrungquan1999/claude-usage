import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// The Mongo driver is server-only; keep it out of any client bundle.
	serverExternalPackages: ["mongodb"],

	experimental: {
		// TypeScript 7 is the Go port and drops the JS compiler API Next reaches for by default;
		// without this the dev server boots, then hangs every request on an unhandled rejection.
		useTypeScriptCli: true,
	},
};

export default nextConfig;
