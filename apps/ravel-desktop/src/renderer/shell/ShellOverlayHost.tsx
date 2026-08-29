import * as React from "react";
import { CommandPalette } from "../components/layout/CommandPalette";
import { TreeOverlay } from "../components/layout/TreeOverlay";
import { FileViewer } from "../components/files/FileViewer";
import { ExtensionUIHost } from "../components/layout/ExtensionUIHost";
import { TrustCenter } from "../components/layout/TrustCenter";

/**
 * Central home for the modal/overlay surfaces that used to render directly in
 * `App`. Moving them here lets the shell own the topmost layer while `App`
 * stays a thin composition. Each overlay keeps its original props/behavior;
 * none of them receive props today.
 */
export function ShellOverlayHost(): React.ReactElement {
  return (
    <>
      <CommandPalette />
      <TreeOverlay />
      <FileViewer />
      <ExtensionUIHost />
      <TrustCenter />
    </>
  );
}