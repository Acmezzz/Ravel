import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "./utils";

type StaticClassProps = { className?: string };

export function TooltipProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  return <TooltipPrimitive.Provider delay={320}>{children}</TooltipPrimitive.Provider>;
}

export const Tooltip = TooltipPrimitive.Root;

export interface TooltipTriggerProps extends Omit<React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>, "render"> {
  asChild?: boolean;
  children?: React.ReactNode;
}

export const TooltipTrigger = React.forwardRef<HTMLButtonElement, TooltipTriggerProps>(function TooltipTrigger({ asChild, children, ...props }, ref) {
  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      render={asChild ? (React.Children.only(children) as React.ReactElement) : undefined}
      {...props}
    >
      {asChild ? undefined : children}
    </TooltipPrimitive.Trigger>
  );
});

export interface TooltipContentProps extends Omit<React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Popup>, "className">, StaticClassProps {
  side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Positioner>["side"];
  sideOffset?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Positioner>["sideOffset"];
}

export const TooltipContent = React.forwardRef<HTMLDivElement, TooltipContentProps>(function TooltipContent({ className, side, sideOffset = 6, children, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset}>
        <TooltipPrimitive.Popup ref={ref} className={cn("omega-tooltip", className)} {...props}>
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
});
