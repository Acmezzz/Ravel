import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "./utils";

type StaticClassProps = { className?: string };

export const Menu = MenuPrimitive.Root;

export interface MenuAnchorProps extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean;
  children?: React.ReactNode;
}

export const MenuAnchor = React.forwardRef<HTMLButtonElement, MenuAnchorProps>(function MenuAnchor({ asChild, children, ...props }, ref) {
  return (
    <MenuPrimitive.Trigger
      ref={ref}
      render={asChild ? (React.Children.only(children) as React.ReactElement) : undefined}
      {...props}
    >
      {asChild ? undefined : children}
    </MenuPrimitive.Trigger>
  );
});

export interface MenuTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

export const MenuTrigger = React.forwardRef<HTMLButtonElement, MenuTriggerProps>(function MenuTrigger({ asChild, children, ...props }, ref) {
  return (
    <MenuPrimitive.Trigger
      ref={ref}
      render={asChild ? (React.Children.only(children) as React.ReactElement) : undefined}
      {...props}
    >
      {asChild ? undefined : children}
    </MenuPrimitive.Trigger>
  );
});

export const MenuSeparator = React.forwardRef<HTMLDivElement, Omit<React.ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>, "className"> & StaticClassProps>(function MenuSeparator({ className, ...props }, ref) {
  return <MenuPrimitive.Separator ref={ref} className={cn("omega-menu-separator", className)} {...props} />;
});

export const MenuLabel = React.forwardRef<HTMLDivElement, Omit<React.ComponentPropsWithoutRef<typeof MenuPrimitive.GroupLabel>, "className"> & StaticClassProps>(function MenuLabel({ className, ...props }, ref) {
  return <MenuPrimitive.GroupLabel ref={ref} className={cn("omega-menu-label", className)} {...props} />;
});

export const MenuItem = React.forwardRef<HTMLElement, Omit<React.ComponentPropsWithoutRef<typeof MenuPrimitive.Item>, "className"> & StaticClassProps>(function MenuItem({ className, ...props }, ref) {
  return <MenuPrimitive.Item ref={ref} className={cn("omega-menu-item", className)} {...props} />;
});

export const MenuContent = React.forwardRef<HTMLDivElement, Omit<React.ComponentPropsWithoutRef<typeof MenuPrimitive.Popup>, "className"> & StaticClassProps>(function MenuContent({ className, children, ...props }, ref) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner>
        <MenuPrimitive.Popup ref={ref} className={cn("omega-menu-content", className)} {...props}>
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
});
