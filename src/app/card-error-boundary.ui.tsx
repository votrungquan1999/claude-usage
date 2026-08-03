"use client";

import { Component, type ReactNode } from "react";

export interface CardErrorBoundaryProps {
	/** Rendered in place of `children` once a render below this point has thrown. Composed by the
	 * server so the message stays out of the client bundle's copy. */
	fallback: ReactNode;
	children: ReactNode;
}

interface CardErrorBoundaryState {
	failed: boolean;
}

/**
 * Isolates one dashboard card's failure to that card. Hand-rolled because React error boundaries
 * can only be class components, and because Next's `error.tsx` isolates at the ROUTE level — a
 * single failing query would blank the whole dashboard. That matters more than usual here: the
 * shared loaders cache thrown errors (D26), so one Mongo failure is re-thrown to every card that
 * reads the same window.
 */
export class CardErrorBoundary extends Component<CardErrorBoundaryProps, CardErrorBoundaryState> {
	state: CardErrorBoundaryState = { failed: false };

	/**
	 * Switches this boundary to its fallback when a descendant throws during render.
	 */
	static getDerivedStateFromError(): CardErrorBoundaryState {
		return { failed: true };
	}

	/**
	 * Renders the card, or its fallback once a descendant has thrown.
	 */
	render(): ReactNode {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}
