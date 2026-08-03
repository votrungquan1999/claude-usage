import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CostSplitDimension } from "@/server/usage-queries";

import { CardErrorBoundary } from "../card-error-boundary.ui";
import { CardErrorNotice, CardPlaceholder } from "../dashboard-shell.ui";
import { CostSplitView } from "./cost-split-view";
import { SplitTab } from "./cost-split-view.type";
import { SplitTabs } from "./cost-split-view.ui";

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
					<TabsList>
						<TabsTrigger value={SplitTab.Machine}>Machine</TabsTrigger>
						<TabsTrigger value={SplitTab.Project}>Project</TabsTrigger>
						<TabsTrigger value={SplitTab.Model}>Model</TabsTrigger>
					</TabsList>
					<TabsContent value={SplitTab.Machine}>
						<SplitPanel dimension={CostSplitDimension.Machine} dimensionLabel="Machine" {...viewWindow} />
					</TabsContent>
					<TabsContent value={SplitTab.Project}>
						<SplitPanel dimension={CostSplitDimension.Project} dimensionLabel="Project" {...viewWindow} />
					</TabsContent>
					<TabsContent value={SplitTab.Model}>
						<SplitPanel dimension={CostSplitDimension.Model} dimensionLabel="Model" {...viewWindow} />
					</TabsContent>
				</SplitTabs>
			</CardContent>
		</Card>
	);
}

interface SplitPanelProps {
	dimension: CostSplitDimension;
	dimensionLabel: string;
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
function SplitPanel({ dimension, dimensionLabel, ...viewWindow }: SplitPanelProps): React.JSX.Element {
	return (
		<CardErrorBoundary fallback={<CardErrorNotice>This split could not be loaded</CardErrorNotice>}>
			<Suspense fallback={<CardPlaceholder />}>
				<CostSplitView dimension={dimension} dimensionLabel={dimensionLabel} {...viewWindow} />
			</Suspense>
		</CardErrorBoundary>
	);
}
