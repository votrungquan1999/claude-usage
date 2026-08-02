import { LoginForm } from "./login-form";

/**
 * The one page the proxy never gates — where an operator without a valid session lands.
 */
export default function LoginPage(): React.JSX.Element {
	return (
		<main className="grid min-h-screen place-items-center bg-background p-8">
			<LoginForm />
		</main>
	);
}
