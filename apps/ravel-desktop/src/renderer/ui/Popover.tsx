import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "./utils";

export interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
  contentStyle?: React.CSSProperties;
  ariaLabel?: string;
}

/** Controlled, anchor-based popover with static token styling and no runtime CSS injection. */
export function Popover({ anchor, open, onOpenChange, children, className, contentStyle, ariaLabel }: PopoverProps): React.ReactElement {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          anchor={anchor}
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={12}
        >
          <PopoverPrimitive.Popup
            initialFocus={false}
            aria-label={ariaLabel}
            className={cn("omega-popover", className)}
            style={contentStyle}
          >
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
