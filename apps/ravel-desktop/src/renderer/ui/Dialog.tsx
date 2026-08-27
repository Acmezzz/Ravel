import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "./utils";

type StaticClassProps = { className?: string };

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = React.forwardRef<HTMLDivElement, Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Backdrop>, "className"> & StaticClassProps>(function DialogOverlay({ className, ...props }, ref) {
  return <DialogPrimitive.Backdrop ref={ref} className={cn("omega-dialog-overlay", className)} {...props} />;
});

export const DialogContent = React.forwardRef<HTMLDivElement, Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Popup>, "className"> & StaticClassProps>(function DialogContent({ className, children, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Popup ref={ref} className={cn("omega-dialog-content", className)} {...props}>
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
});

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn("omega-dialog-header", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn("omega-dialog-footer", className)} {...props} />;
}

export const DialogTitle = React.forwardRef<HTMLHeadingElement, Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>, "className"> & StaticClassProps>(function DialogTitle({ className, ...props }, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn("omega-dialog-title", className)} {...props} />;
});

export const DialogDescription = React.forwardRef<HTMLParagraphElement, Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>, "className"> & StaticClassProps>(function DialogDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn("omega-dialog-description", className)} {...props} />;
});

export const DialogContentArea = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function DialogContentArea({ className, ...props }, ref) {
  return <div ref={ref} className={cn("omega-dialog-content-area", className)} {...props} />;
});
