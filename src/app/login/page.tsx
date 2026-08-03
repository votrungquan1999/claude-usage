import { LoginForm } from "./login-form";
import { safeReturnPath } from "./login-return-path";

interface LoginPageProps {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The one page the proxy never gates — where an operator without a valid session lands. The
 * destination they were turned away from rides along in `next`; it is validated HERE, on the
 * server, so the form is never handed a value that could send the browser off-origin (D43).
 *
 * @param searchParams - the request's query string, carrying `next` when the proxy set one
 */
export default async function LoginPage({ searchParams }: LoginPageProps): Promise<React.JSX.Element> {
	const next = (await searchParams).next;

	return (
		<main className="grid min-h-screen place-items-center bg-background p-8">
			<LoginForm returnPath={safeReturnPath(typeof next === "string" ? next : null)} />
		</main>
	);
}
