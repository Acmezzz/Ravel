import * as React from "react";
import { cn } from "./utils";

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
	checked?: boolean;	onCheckedChange?: (checked: boolean) => void;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch({ className, checked = false, onCheckedChange, disabled, type = "button", ...props }, ref) {
	return <button ref={ref} type={type} role="switch" aria-checked={checked} disabled={disabled} className={cn("omega-switch", checked && "omega-switch-checked", className)} onClick={() => onCheckedChange?.(!checked)} {...props}><span className="omega-switch-thumb" /></button>;
});
