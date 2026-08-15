import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { CostSplitDimension } from "@/server/usage-queries";

import { CardErrorBoundary } from "../card-error-boundary.ui";
import { CardErrorNotice, CardPlaceholder } from "../dashboard-shell.ui";
import { CostSplitView } from "./cost-split-view";
import { SplitTab } from "./cost-split-view.type";
import { SplitTabs, SplitTabsList } from "./cost-split-view.ui";

export interface CostSplitsProps {
	/** The split the URL asked for. */
	initialTab: SplitTab;
	/** Selected window and colour-domain lookback, epoch milliseconds. */
	fromMs: number;
	toMs: number;
	domainFromMs: number;
	domainToMs: number;
}

/**
 * Cost per day, split three ways. The card names no period — the picker above it does, so the two
 * can never disagree about which window is on screen.
 */
export function CostSplits({ initialTab, fromMs, toMs, domainFromMs, domainToMs }: CostSplitsProps): React.JSX.Element {
	const viewWindow = { fromMs, toMs, domainFromMs, domainToMs };

	return (
		<Card>
			<CardHeader>
				<CardTitle>Cost per day</CardTitle>
			</CardHeader>
			<CardContent>
				<SplitTabs initialTab={initialTab}>
					<SplitTabsList>
						<TabsTrigger value={SplitTab.Machine}>Machine</TabsTrigger>
						<TabsTrigger value={SplitTab.Project}>Project</TabsTrigger>
						<TabsTrigger value={SplitTab.Model}>Model</TabsTrigger>
						<TabsTrigger value={SplitTab.Repo}>Repo</TabsTrigger>
					</SplitTabsList>
					<TabsContent value={SplitTab.Machine}>
						<SplitPanel
							dimension={CostSplitDimension.Machine}
							dimensionLabel="Machine"
							tab={SplitTab.Machine}
							{...viewWindow}
						/>
					</TabsContent>
					<TabsContent value={SplitTab.Project}>
						<SplitPanel
							dimension={CostSplitDimension.Project}
							dimensionLabel="Project"
							tab={SplitTab.Project}
							{...viewWindow}
						/>
					</TabsContent>
					<TabsContent value={SplitTab.Model}>
						<SplitPanel dimension={CostSplitDimension.Model} dimensionLabel="Model" tab={SplitTab.Model} {...viewWindow} />
					</TabsContent>
					<TabsContent value={SplitTab.Repo}>
						<SplitPanel
							dimension={CostSplitDimension.Repo}
							dimensionLabel="Repository"
							tab={SplitTab.Repo}
							{...viewWindow}
						/>
					</TabsContent>
				</SplitTabs>
			</CardContent>
		</Card>
	);
}

interface SplitPanelProps {
	dimension: CostSplitDimension;
	dimensionLabel: string;
	tab: SplitTab;
	fromMs: number;
	toMs: number;
	domainFromMs: number;
	domainToMs: number;
}

/**
 * One split's isolation: its own boundary so a failed query costs one split rather than the card,
 * and its own suspense boundary so the three splits stream independently. The error boundary sits
 * OUTSIDE the suspense boundary — a query that rejects throws during the suspended render.
 */
function SplitPanel({ dimension, dimensionLabel, tab, ...viewWindow }: SplitPanelProps): React.JSX.Element {
	return (
		<CardErrorBoundary fallback={<CardErrorNotice>This split could not be loaded</CardErrorNotice>}>
			<Suspense fallback={<CardPlaceholder />}>
				<CostSplitView dimension={dimension} dimensionLabel={dimensionLabel} tab={tab} {...viewWindow} />
			</Suspense>
		</CardErrorBoundary>
	);
}
