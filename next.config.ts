import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// The Mongo driver is server-only; keep it out of any client bundle.
	serverExternalPackages: ["mongodb"],
};

export default nextConfig;
