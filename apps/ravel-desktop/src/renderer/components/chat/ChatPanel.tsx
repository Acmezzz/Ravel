import * as React from "react";
import { useAppStore } from "../../store/useAppStore";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { ExtensionSurface } from "../layout/ExtensionSurface";

export function ChatPanel(): React.ReactElement {
  const messageCount = useAppStore((state) => state.messages.length);
  return <div className="omega-chat-panel">
    <div className="omega-chat-content"><ExtensionSurface /><div className="omega-chat-messages">{messageCount === 0 ? <EmptyState /> : <MessageList />}</div></div>
    <Composer />
  </div>;
}
