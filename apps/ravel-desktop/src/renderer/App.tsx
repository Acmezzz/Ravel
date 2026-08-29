import * as React from "react";
import { Workbench } from "./components/layout/Workbench";
import { CommandPalette } from "./components/layout/CommandPalette";
import { TreeOverlay } from "./components/layout/TreeOverlay";
import { FileViewer } from "./components/files/FileViewer";
import { ExtensionUIHost } from "./components/layout/ExtensionUIHost";
import { TrustCenter } from "./components/layout/TrustCenter";
import { TooltipProvider } from "./ui/Tooltip";
import { useAppStore } from "./store/useAppStore";
import { AppBootstrap } from "./app/AppBootstrap";
import { AppEventBridge } from "./app/AppEventBridge";
import { AppKeyboardShortcuts } from "./app/AppKeyboardShortcuts";

/**
 * Top-level composition component.
 *
 * Coordination (bootstrap, event bridging, keyboard shortcuts) is split into
 * single-responsibility sub-components; this component only follows the OS
 * theme in `system` mode, owns the text zoom state, and assembles the UI.
 */
export function App(): React.ReactElement {
  const themeMode = useAppStore((s) => s.themeMode);

  // Follow OS theme changes while in `system` mode.
  React.useEffect(() => {
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const resolved = mq.matches ? "dark" : "light";
      document.documentElement.classList.toggle("dark", mq.matches);
      document.documentElement.style.colorScheme = resolved;
      useAppStore.setState({ resolvedMode: resolved });
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeMode]);

  // Text zoom: root-relative rem typography scales with the html font size.
  const [textZoom, setTextZoom] = React.useState(1);
  React.useEffect(() => {
    document.documentElement.style.fontSize = textZoom === 1 ? "" : `${(16 * textZoom).toFixed(2)}px`;
  }, [textZoom]);

  return (
    <TooltipProvider>
      <AppBootstrap />
      <AppEventBridge />
      <AppKeyboardShortcuts textZoom={textZoom} onZoomChange={setTextZoom} />
      <Workbench />
      <CommandPalette />
      <TreeOverlay />
      <FileViewer />
      <ExtensionUIHost />
      <TrustCenter />
    </TooltipProvider>
  );
}