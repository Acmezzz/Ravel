import * as React from "react";
import { ChatTranscript } from "../../surfaces/chat/ChatTranscript";
import { ChatComposer } from "../../surfaces/chat/ChatComposer";

/**
 * Chat 中央面板（消息流 + Composer）。任务五起作为 ChatSurface 的中央流核心复用，
 * 内部组合 ChatTranscript（MessageList/EmptyState/ExtensionSurface）与 ChatComposer
 * （Composer）。DOM 外壳与类名保持不变，行为不回归。
 */
export function ChatPanel(): React.ReactElement {
  return <div className="omega-chat-panel">
    <ChatTranscript />
    <ChatComposer />
  </div>;
}