import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** Activate an existing onClick handler from Enter / Space. */
export function keyboardClick(event: ReactKeyboardEvent): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    (event.currentTarget as HTMLElement).click();
  }
}

export const clickableRole = {
  role: "button" as const,
  tabIndex: 0,
  onKeyDown: keyboardClick,
};
