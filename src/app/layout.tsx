import type { Metadata } from "next";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
	title: "Claude Usage",
	description: "Claude Code usage tracking and cost dashboard",
};

/**
 * Root layout — shared HTML shell for every page. Defaults to the dark theme; this is a
 * single-operator dashboard with no theme toggle planned.
 */
export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
	return (
		<html lang="en" className={cn("dark font-sans", geist.variable)}>
			<body>{children}</body>
		</html>
	);
}
