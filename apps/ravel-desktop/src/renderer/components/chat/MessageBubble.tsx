import * as React from "react";
import { Check, Copy, GitFork } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { Markdown } from "../common/Markdown";
import { ThinkingBlock } from "./ThinkingBlock";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { getStreamLive, getStreamLiveKey, subscribeStreamLive } from "../../lib/stream-live";
import { openSessionInStore } from "../../lib/open-session";
import type { SessionMessage, SessionReferenceFact } from "../../types/dto";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyIcon(): React.ReactElement {
  return <Copy className="omega-icon-14" strokeWidth={1.5} aria-hidden="true" />;
}

function CheckIcon(): React.ReactElement {
  return <Check className="omega-icon-14" strokeWidth={1.8} aria-hidden="true" />;
}

function ForkIcon(): React.ReactElement {
  return <GitFork className="omega-icon-14" strokeWidth={1.5} aria-hidden="true" />;
}

export interface MessageBubbleProps {
  message: SessionMessage;
  /** True only for the last assistant message during the active thinking run. */
  streamingRun: boolean;
}

/**
 * Render user text with @Title mention chips resolved through the durable
 * session_reference edges of this transcript. Longest title wins so nested
 * names cannot shadow each other.
 */
function UserTextWithReferences({ text, refs }: { text: string; refs: SessionReferenceFact[] }): React.ReactElement {
  const [navigating, setNavigating] = React.useState(false);
  const handleOpen = React.useCallback(async (sessionId: string) => {
    setNavigating(true);
    try {
      await openSessionInStore(sessionId);
    } finally {
      setNavigating(false);
    }
  }, []);
  if (refs.length === 0 || !text.includes("@")) return <>{text}</>;
  const ordered = [...refs].sort((a, b) => b.targetTitle.length - a.targetTitle.length);
  const byTitle = new Map(ordered.map((ref) => [ref.targetTitle, ref]));
  const pattern = new RegExp(`@(${ordered.map((ref) => ref.targetTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 && part ? (
          <button
            key={`${part}-${index}`}
            type="button"
            className="omega-msg-mention"
            disabled={navigating}
            onClick={() => {
              const ref = byTitle.get(part);
              if (ref) void handleOpen(ref.targetSessionId);
            }}
            title={byTitle.get(part)?.targetSessionId}
          >
            @{part}
          </button>
        ) : (
          <React.Fragment key={`t-${index}`}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

function MessageBubbleInner({ message, streamingRun }: MessageBubbleProps): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  const liveKey = React.useSyncExternalStore(
    subscribeStreamLive,
    () => getStreamLiveKey(message.id),
    () => "",
  );
  const live = React.useMemo(() => {
    if (!streamingRun && !liveKey) return null;
    const snapshot = getStreamLive(message.id);
    return { text: snapshot.text || message.text, thinking: snapshot.thinking || message.thinking || "" };
  }, [message.id, message.text, message.thinking, streamingRun, liveKey]);
  const renderedMessage = live ? { ...message, text: live.text, thinking: live.thinking || message.thinking } : message;
  const [forking, setForking] = React.useState(false);
  const isUser = message.role === "user";
  const isError = message.role === "assistant" && renderedMessage.text.startsWith("⚠️");
  const connection = useAppStore((s) => s.connection);
  const setComposerPrefill = useAppStore((s) => s.setComposerPrefill);
  const loadTranscript = useAppStore((s) => s.loadTranscript);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setAgent = useAppStore((s) => s.setAgent);

  const handleCopy = React.useCallback(async () => {
    const ok = await copyText(renderedMessage.text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }, [renderedMessage.text]);

  const handleFork = React.useCallback(async () => {
    if (!message.entryId || forking) return;
    setForking(true);
    try {
      const res = await ipc.fork({ entryId: message.entryId });
      if (res.ok) {
        setActiveSession(res.data.record.id);
        loadTranscript(res.data.record);
        const state = await ipc.getState();
        if (state.ok) setAgent(state.data);
        const list = await ipc.listSessions();
        if (list.ok) useAppStore.getState().applySessionPage(list.data);
        if (res.data.selectedText) setComposerPrefill(res.data.selectedText);
      }
    } finally {
      setForking(false);
    }
  }, [message.entryId, forking, setActiveSession, loadTranscript, setAgent, setComposerPrefill]);

  const canFork = Boolean(isUser && message.entryId) && connection !== "running";
  const references = useAppStore((s) => s.references);
  const userRefs = React.useMemo(
    () => (isUser && message.entryId ? references.filter((ref) => ref.sourceEntryId === message.entryId) : []),
    [isUser, message.entryId, references],
  );
  const showThinking = !isUser && !isError && (Boolean(renderedMessage.thinking) || message.thinkingDeferred);
  const isStreamingTarget = streamingRun;

  return (
    <div className={`omega-msg ${isUser ? "omega-msg-user" : "omega-msg-assistant"}`} data-entry-id={message.entryId ?? undefined} tabIndex={message.entryId ? -1 : undefined}>
      <div className="omega-msg-col">
        {showThinking ? (
          <ThinkingBlock
            text={renderedMessage.thinking ?? ""}
            streaming={isStreamingTarget && Boolean(renderedMessage.thinking)}
            deferred={message.thinkingDeferred}
            entryId={message.entryId}
          />
        ) : null}
        <div className={isUser ? "omega-msg-user-bubble" : isError ? "omega-msg-assistant-body omega-msg-error" : "omega-msg-assistant-body"}>
          {isUser ? (
            <p className="omega-msg-user-text">
              <UserTextWithReferences text={renderedMessage.text} refs={userRefs} />
            </p>
          ) : isError ? (
            <p className="omega-msg-error-text">{renderedMessage.text}</p>
          ) : (
            <Markdown>{renderedMessage.text}</Markdown>
          )}
          {isStreamingTarget ? <span className="stream-caret" aria-hidden="true" /> : null}
        </div>
        {!isError && renderedMessage.text ? (
          <div className="msg-actions">
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton size="sm" className="omega-msg-action" label="复制消息" onClick={() => void handleCopy()}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>{copied ? "已复制" : "复制消息"}</TooltipContent>
            </Tooltip>
            {canFork ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton size="sm" className="omega-msg-action" label="从此处 Fork 新会话" onClick={() => void handleFork()} disabled={forking}>
                    <ForkIcon />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent>{forking ? "创建中…" : "从此处 Fork 新会话"}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const MessageBubble = React.memo(MessageBubbleInner);
