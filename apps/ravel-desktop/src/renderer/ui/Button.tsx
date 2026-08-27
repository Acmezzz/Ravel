import * as React from "react";
import { cn } from "./utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "solid" | "quiet" | "outline";
	size?: "sm" | "md" | "lg";
	leading?: React.ReactNode;
	trailing?: React.ReactNode;
	fullWidth?: boolean;
	loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{ className, variant = "outline", size = "md", leading, trailing, fullWidth, loading, disabled, children, type = "button", ...props },
	ref,
) {
	return (
		<button
			ref={ref}
			type={type}
			className={cn("omega-button", `omega-button-${variant}`, `omega-button-${size}`, fullWidth && "omega-button-full", loading && "omega-button-loading", className)}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			{...props}
		>
			{leading ? <span className="omega-button-leading" aria-hidden="true">{leading}</span> : null}
			{loading ? <span className="omega-spinner" aria-hidden="true" /> : null}
			{children}
			{trailing ? <span className="omega-button-trailing" aria-hidden="true">{trailing}</span> : null}
		</button>
	);
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	label: string;
	size?: "sm" | "md" | "lg";
	active?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
	{ className, label, size = "md", active, type = "button", ...props },
	ref,
) {
	return <button ref={ref} type={type} aria-label={label} aria-pressed={active === undefined ? undefined : active} className={cn("omega-icon-button", `omega-icon-button-${size}`, active && "omega-icon-button-active", className)} {...props} />;
});
