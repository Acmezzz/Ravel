/**
 * 任务五：Chat Surface 的中央消息流。
 *
 * 复用 components/chat/MessageList（内部已用 TanStack Virtual 虚拟滚动、stream-live
 * 批处理流式、工具卡汇总、compaction marker、历史翻页），并按 ChatPanel 原有语义
 * 处理 ExtensionSurface 与空态。这里不重复实现任何消息渲染/流式逻辑。
 */
import * as React from "react";
import { useAppStore } from "../../store/useAppStore";
import { ExtensionSurface } from "../../components/layout/ExtensionSurface";
import { MessageList } from "../../components/chat/MessageList";
import { EmptyState } from "../../components/chat/EmptyState";

export function ChatTranscript(): React.ReactElement {
  const messageCount = useAppStore((state) => state.messages.length);
  return (
    <div className="omega-chat-content">
      <ExtensionSurface />
      <div className="omega-chat-messages">{messageCount === 0 ? <EmptyState /> : <MessageList />}</div>
    </div>
  );
}