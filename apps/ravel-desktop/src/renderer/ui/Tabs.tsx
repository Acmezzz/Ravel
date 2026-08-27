import * as React from "react";
import { cn } from "./utils";

interface TabsContextValue { value: string; onValueChange: (value: string) => void; }
const TabsContext = React.createContext<TabsContextValue | null>(null);

export interface TabsProps { value?: string; defaultValue?: string; onValueChange?: (value: string) => void; children: React.ReactNode; className?: string; }
export function Tabs({ value: controlledValue, defaultValue, onValueChange, children, className }: TabsProps): React.ReactElement {
	const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue ?? "");
	const value = controlledValue ?? uncontrolledValue;
	const change = (next: string) => { if (controlledValue === undefined) setUncontrolledValue(next); onValueChange?.(next); };
	return <TabsContext.Provider value={{ value, onValueChange: change }}><div className={cn("omega-tabs", className)}>{children}</div></TabsContext.Provider>;
}
export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement { return <div role="tablist" className={cn("omega-tabs-list", className)} {...props} />; }
export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { value: string; }
export function TabsTrigger({ value, className, onClick, ...props }: TabsTriggerProps): React.ReactElement {
	const context = React.useContext(TabsContext);
	if (!context) throw new Error("TabsTrigger must be used inside Tabs");
	const selected = context.value === value;
	return <button type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} className={cn("omega-tab-trigger", selected && "omega-tab-trigger-active", className)} onClick={(event) => { context.onValueChange(value); onClick?.(event); }} {...props} />;
}
export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> { value: string; }
export function TabsContent({ value, className, children, ...props }: TabsContentProps): React.ReactElement | null {
	const context = React.useContext(TabsContext);
	if (!context) throw new Error("TabsContent must be used inside Tabs");
	return context.value === value ? <div role="tabpanel" className={cn("omega-tab-content", className)} {...props}>{children}</div> : null;
}
