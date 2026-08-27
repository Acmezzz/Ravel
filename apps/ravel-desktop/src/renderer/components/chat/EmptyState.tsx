import * as React from "react";
import { Button } from "../../ui/Button";
import { ipc } from "../../ipc/client";
import { useAppStore } from "../../store/useAppStore";
import { userMessageKey } from "../../lib/prompt-recovery";
import { useT } from "../../lib/i18n";

const SUGGESTIONS = ["检查当前项目的测试状态", "分析最近一次失败的原因", "为这个模块编写单元测试"];
const INFINITY_PATH = "M 16 16 C 16 9.5, 25 9.5, 25 16 C 25 22.5, 16 22.5, 16 16 C 16 9.5, 7 9.5, 7 16 C 7 22.5, 16 22.5, 16 16 Z";

export function EmptyState(): React.ReactElement {
  const t = useT();
  const setConnection = useAppStore((state) => state.setConnection);
  const sendSuggestion = React.useCallback(async (prompt: string) => {
    const clientMessageId = `suggestion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const messageId = `optimistic-${clientMessageId}`;
    const sentAt = Date.now();
    const key = userMessageKey({ text: prompt, images: [] });
    useAppStore.getState().addOptimisticMessage({ key, clientMessageId, messageId, text: prompt, createdAt: sentAt }, { role: "user", id: messageId, text: prompt, ts: new Date().toISOString() });
    setConnection("running");
    try {
      const res = await ipc.prompt(prompt, undefined, undefined, clientMessageId);
      if (!res.ok) { useAppStore.getState().dropLastIfOptimistic(key); useAppStore.getState().setComposerError(`${res.code}: ${res.message ?? t("common.unknownError")}`); useAppStore.getState().setConnection("ready"); }
    } catch (error) {
      console.error("prompt failed", error);
      useAppStore.getState().dropLastIfOptimistic(key);
      useAppStore.getState().setComposerError(error instanceof Error ? error.message : String(error));
      useAppStore.getState().setConnection("ready");
    }
  }, [setConnection, t]);
  return <div className="omega-empty-state"><div className="omega-empty-content"><div className="omega-empty-mark"><svg width="36" height="36" viewBox="0 0 32 32" aria-hidden="true"><path d={INFINITY_PATH} fill="none" stroke="var(--omega-accent)" strokeWidth="2.4" strokeLinecap="round" /></svg></div><h2>开始与 Ravel 协作</h2><p>描述一个问题、目标或需要探索的方向，Agent 会在当前工作区中协助你。</p><p className="omega-empty-hints"><kbd className="kbd">Ctrl+K</kbd> 命令面板 · <kbd className="kbd">Ctrl+Shift+N</kbd> 新建会话 · 生成中可插入消息或停止</p><div className="omega-empty-suggestions">{SUGGESTIONS.map((suggestion) => <Button key={suggestion} variant="outline" size="sm" onClick={() => void sendSuggestion(suggestion)}>{suggestion}</Button>)}</div></div></div>;
}
