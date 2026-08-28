import * as React from "react";
import { Command, Paperclip, RotateCcw, Send, Square, Zap } from "lucide-react";
import { IconButton } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/Tooltip";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { userMessageKey } from "../../lib/prompt-recovery";
import { clearDraft, getDraft, mergeDraftText, setDraft, type DraftImage } from "../../lib/draft-store";
import { PlanReview } from "./PlanReview";
import { useT } from "../../lib/i18n";
import type { PromptImage } from "../../types/dto";

const MAX_IMAGES = 4;
/** IME composition guard (port of pi-web, MIT): keyCode 229 + 100ms post-composition grace. */
const COMPOSITION_END_ENTER_GRACE_MS = 100;

interface Attachment extends PromptImage {
  key: string;
  name: string;
}

/** A pending @session reference resolved through the composer mention menu. */
interface PendingReference {
  targetSessionId: string;
  targetTitle: string;
}

type AtItem = { kind: "session"; sessionId: string; title: string } | { kind: "file"; path: string };

function readImageFile(file: File): Promise<PromptImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      const header = comma > 0 ? result.slice(0, comma) : "";
      const data = comma > 0 ? result.slice(comma + 1) : "";
      const match = /data:(image\/[\w.+-]+)/.exec(header);
      if (!match || !data) {
        reject(new Error("Unsupported image"));
        return;
      }
      resolve({ mimeType: match[1], data });
    };
    reader.readAsDataURL(file);
  });
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function CommandIcon(): React.ReactElement {
  return <Command className="omega-icon-16" aria-hidden="true" />;
}

function AttachFile(): React.ReactElement {
  return <Paperclip className="omega-icon-16" aria-hidden="true" />;
}

function ReplayIcon(): React.ReactElement {
  return <RotateCcw className="omega-icon-14" aria-hidden="true" />;
}

function BoltIcon(): React.ReactElement {
  return <Zap className="omega-icon-16" fill="currentColor" aria-hidden="true" />;
}

function StopIcon(): React.ReactElement {
  return <Square className="omega-icon-14" fill="currentColor" aria-hidden="true" />;
}

function SendIcon(): React.ReactElement {
  return <Send className="omega-icon-14" aria-hidden="true" />;
}

function QueuedRow({ kind, text }: { kind: "steer" | "followUp"; text: string }): React.ReactElement {
  const t = useT();
  const isSteer = kind === "steer";
  return (
    <div className="omega-composer-queue-row">
      <span className={isSteer ? "omega-chip omega-chip-steer" : "omega-chip omega-chip-queue"}>
        {isSteer ? t("composer.queueSteer") : t("composer.queueFollowUp")}
      </span>
      <span title={text} className="omega-composer-queue-text">{truncate(text)}</span>
    </div>
  );
}

export function Composer(): React.ReactElement {
  const t = useT();
  const [text, setText] = React.useState("");
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyIndex, setHistoryIndex] = React.useState(0);
  const [atItems, setAtItems] = React.useState<AtItem[]>([]);
  const [atOpen, setAtOpen] = React.useState(false);
  const [atIndex, setAtIndex] = React.useState(0);
  /** Accepted @session mentions for the current draft, keyed by session id. */
  const [pendingReferences, setPendingReferences] = React.useState<PendingReference[]>([]);
  const atTokenRef = React.useRef("");
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const isComposingRef = React.useRef(false);
  const lastCompositionEndAtRef = React.useRef(0);
  /** Synchronous double-send guard only — the prompt itself is fire-and-forget. */
  const sendingRef = React.useRef(false);
  /** Session that the current `text` belongs to (guards the draft persist effect). */
  const textSessionRef = React.useRef<string | null>(null);
  const atTimerRef = React.useRef<number>(0);
  const atRequestRef = React.useRef(0);

  const setConnection = useAppStore((s) => s.setConnection);
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const connection = useAppStore((s) => s.connection);
  const shutdownPhase = useAppStore((s) => s.shutdownPhase);
  const composerError = useAppStore((s) => s.composerError);
  const composerPrefill = useAppStore((s) => s.composerPrefill);
  const setComposerError = useAppStore((s) => s.setComposerError);
  const setComposerPrefill = useAppStore((s) => s.setComposerPrefill);
  const queuedMessages = useAppStore((s) => s.queuedMessages);
  const setQueuedMessages = useAppStore((s) => s.setQueuedMessages);
  // Message deltas do not affect input history. Subscribe to length only so
  // streaming assistant updates do not re-render the composer.
  const messageCount = useAppStore((s) => s.messages.length);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const running = connection === "running";
  const shuttingDown = shutdownPhase !== "idle";

  // Restore the draft whenever the active session changes. Declared BEFORE the
  // persist effect so `textSessionRef` is re-anchored first.
  React.useEffect(() => {
    textSessionRef.current = activeSessionId;
    const draft = getDraft(activeSessionId);
    setText(draft?.value ?? "");
    setPendingReferences([]);
    setAttachments(
      (draft?.images ?? []).map((image: DraftImage, index) => ({
        ...image,
        name: "图片",
        key: `draft-${index}`,
      })),
    );
  }, [activeSessionId]);

  // Fork prefill: consume once; merging on top of whatever the draft restored.
  React.useEffect(() => {
    if (composerPrefill === null) return;
    const prefill = composerPrefill;
    setComposerPrefill(null);
    setText((prev) => (prev.trim() ? mergeDraftText(prefill, prev) : prefill));
    taRef.current?.focus();
  }, [composerPrefill, setComposerPrefill]);

  // Persist the draft only when the text itself changes — the transient commit
  // right after a session switch still carries the OLD text, so keying on the
  // session id here would write A's draft into B's slot.
  React.useEffect(() => {
    setDraft(textSessionRef.current, {
      value: text,
      images: attachments.map(({ mimeType, data }) => ({ mimeType, data })),
    });
  }, [text, attachments]);

  // Input history derived from this session's user messages (port of pi-web).
  const inputHistory = React.useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    const messages = useAppStore.getState().messages;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role !== "user" || !message.text.trim()) continue;
      if (message.id.startsWith("optimistic-")) continue;
      if (seen.has(message.text)) continue;
      seen.add(message.text);
      history.push(message.text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messageCount]);

  const addFiles = React.useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    const loaded: Attachment[] = [];
    for (const file of images) {
      try {
        const image = await readImageFile(file);
        loaded.push({ ...image, name: file.name || "image", key: `${file.name}-${Date.now()}-${loaded.length}` });
      } catch (error) {
        setComposerError(error instanceof Error ? error.message : "图片读取失败");
      }
    }
    if (loaded.length > 0) {
      setAttachments((prev) => [...prev, ...loaded].slice(0, MAX_IMAGES));
    }
  }, [setComposerError]);

  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = e.clipboardData?.files;
      if (files && files.length > 0 && Array.from(files).some((file) => file.type.startsWith("image/"))) {
        e.preventDefault();
        void addFiles(files);
      }
    },
    [addFiles],
  );

  const onDelete = React.useCallback((key: string) => {
    setAttachments((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const runBash = React.useCallback(
    (rawValue: string) => {
      if (shuttingDown) return;
      const exclude = rawValue.startsWith("!!");
      const command = (exclude ? rawValue.slice(2) : rawValue.slice(1)).trim();
      setText("");
      setHistoryOpen(false);
      clearDraft(textSessionRef.current);
      if (!command) return;
      useAppStore.getState().appendMessage({
        role: "user",
        id: `bash-${Date.now()}`,
        text: rawValue.split("\n")[0],
        ts: new Date().toISOString(),
      });
      setConnection("running");
      void (async () => {
        try {
          const res = await ipc.bash({ command, excludeFromContext: exclude });
          if (res.ok) {
            useAppStore.getState().appendMessage({
              role: "assistant",
              id: `bash-out-${Date.now()}`,
              text: `\`\`\`\n${res.data.output || "(无输出)"}\n\`\`\`${res.data.exitCode ? `\n\nexit ${res.data.exitCode}` : ""}`,
              ts: new Date().toISOString(),
            });
          } else {
            useAppStore.getState().setComposerError(`命令失败：${res.message ?? "未知错误"}`);
          }
        } finally {
          useAppStore.getState().setConnection("ready");
        }
      })();
    },
    [setConnection, shuttingDown],
  );

  const send = React.useCallback(
    (behavior?: "steer" | "followUp") => {
      if (shuttingDown) return;
      const value = text.trim();
      if ((!value && attachments.length === 0) || sendingRef.current) return;
      if (value.startsWith("!")) {
        runBash(value);
        return;
      }
      sendingRef.current = true;
      setTimeout(() => {
        sendingRef.current = false;
      }, 120);
      const sentAt = Date.now();
      const images = attachments.map(({ mimeType, data }) => ({ mimeType, data }));
      const payload = value || "（请查看图片）";
      // Mentions accepted through the @ menu travel as structured references;
      // the worker appends the routing block and records the durable edge.
      const references = pendingReferences.length > 0 ? pendingReferences : undefined;
      setText("");
      setHistoryOpen(false);
      setAttachments([]);
      setPendingReferences([]);
      clearDraft(textSessionRef.current);
      setComposerError(null);
      setConnection("running");

      // Optimistic bubble: consumed/replaced when the SDK replays the user
      // message via message_start/message_end.
      const clientMessageId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic = {
        role: "user" as const,
        id: `optimistic-${clientMessageId}`,
        text: value || "（图片）",
        ts: new Date().toISOString(),
      };
      const key = userMessageKey({ text: payload, images });
      useAppStore.getState().addOptimisticMessage(
        { key, clientMessageId, messageId: optimistic.id, text: optimistic.text, createdAt: sentAt },
        optimistic,
      );

      // Fire-and-forget: the IPC promise resolves when the whole turn settles
      // (non-streaming path) — blocking on it would disable Steer/Stop/Enter
      // for the entire run. Errors are handled below.
      void (async () => {
        try {
          const res = await ipc.prompt(payload, behavior ?? (running ? "followUp" : undefined), images.length > 0 ? images : undefined, clientMessageId, references);
          if (!res.ok) {
            const agentStarted = useAppStore.getState().lastAgentStartAt >= sentAt;
            useAppStore.getState().dropLastIfOptimistic(key);
            if (!agentStarted) {
              // Deterministic early rejection: give the text back.
              setText((prev) => mergeDraftText(value || "（请查看图片）", prev));
              setAttachments((prev) => [...prev, ...attachments].slice(0, MAX_IMAGES));
              setConnection("ready");
            }
            setComposerError(`${res.code}: ${res.message ?? t("common.unknownError")}`);
            useAppStore.getState().setComposerError(`发送失败（${res.code}）：${res.message ?? "未知错误"}`);
            return;
          }
          // Extension commands never replay a user message — drop the orphan.
          const state = useAppStore.getState();
          if (state.optimisticKey === key) {
            state.dropLastIfOptimistic(key);
          }
        } catch (error) {
          const agentStarted = useAppStore.getState().lastAgentStartAt >= sentAt;
          useAppStore.getState().dropLastIfOptimistic(key);
          if (!agentStarted) {
            setText((prev) => mergeDraftText(value || "（请查看图片）", prev));
            setConnection("ready");
          }
          setComposerError(error instanceof Error ? error.message : String(error));
        }
      })();
    },
    [text, attachments, pendingReferences, running, shuttingDown, setConnection, setComposerError, runBash, t],
  );

  const abort = React.useCallback(async () => {
    try {
      await ipc.abort();
      setConnection("ready");
    } catch {
      /* best effort */
    }
  }, [setConnection]);

  const recallQueue = React.useCallback(async () => {
    if (shuttingDown) return;
    const res = await ipc.clearQueue();
    if (!res.ok) return;
    setQueuedMessages({ steering: [], followUp: [] });
    const texts = [...res.data.steering, ...res.data.followUp];
    if (texts.length > 0) {
      setText((prev) => (prev.trim() ? `${texts.join("\n\n")}\n\n${prev}` : texts.join("\n\n")));
      taRef.current?.focus();
    }
  }, [setQueuedMessages, shuttingDown]);

  const applyHistory = React.useCallback((entry: string) => {
    setHistoryOpen(false);
    setText(entry);
    requestAnimationFrame(() => taRef.current?.focus());
  }, []);

  // `@` completion: session mentions (from the store) merged with file index
  // results, sessions first. Single menu state machine — one listbox serves
  // both kinds so they can never stack.
  const detectAtToken = React.useCallback((value: string, caret: number) => {
    const before = value.slice(0, caret);
    const match = /(?:^|\s)@([\w./\\-]*)$/.exec(before);
    if (!match) {
      setAtOpen(false);
      setAtItems([]);
      atTokenRef.current = "";
      atRequestRef.current += 1;
      return;
    }
    const token = match[1];
    const requestId = ++atRequestRef.current;
    atTokenRef.current = token;
    setAtOpen(true);
    setAtIndex(0);
    const lowerToken = token.toLowerCase();
    const activeWorkspace = useAppStore.getState().agent?.cwd;
    const activeSessionId = useAppStore.getState().activeSessionId;
    const sessionItems: AtItem[] = useAppStore
      .getState()
      .sessions.filter(
        (session) =>
          !session.parentSessionId &&
          session.id !== activeSessionId &&
          (!activeWorkspace || session.workspace === activeWorkspace) &&
          (lowerToken === "" || session.title.toLowerCase().includes(lowerToken)),
      )
      .slice(0, 6)
      .map((session) => ({ kind: "session" as const, sessionId: session.id, title: session.title }));
    if (sessionItems.length > 0) {
      setAtItems(sessionItems);
    } else {
      setAtItems([]);
    }
    window.clearTimeout(atTimerRef.current);
    atTimerRef.current = window.setTimeout(() => {
      void ipc.fileIndex({ query: token }).then((res) => {
        if (requestId !== atRequestRef.current || atTokenRef.current !== token) return;
        const fileItems: AtItem[] = res.ok ? res.data.slice(0, 8).map((path) => ({ kind: "file" as const, path })) : [];
        // Re-read sessions: a title typed while files were loading may now win.
        const latestSessions: AtItem[] = useAppStore
          .getState()
          .sessions.filter(
            (session) =>
              !session.parentSessionId &&
              session.id !== useAppStore.getState().activeSessionId &&
              (lowerToken === "" || session.title.toLowerCase().includes(lowerToken)),
          )
          .slice(0, 6)
          .map((session) => ({ kind: "session" as const, sessionId: session.id, title: session.title }));
        const combined = [...latestSessions, ...fileItems];
        setAtItems(combined);
        if (combined.length === 0) setAtOpen(false);
      });
    }, 150);
  }, []);

  React.useEffect(() => () => window.clearTimeout(atTimerRef.current), []);

  const applyAt = React.useCallback((item: AtItem) => {
    const ta = taRef.current;
    setAtOpen(false);
    if (item.kind === "session") {
      setPendingReferences((prev) =>
        prev.some((ref) => ref.targetSessionId === item.sessionId) || prev.some((ref) => ref.targetTitle === item.title)
          ? prev
          : [...prev, { targetSessionId: item.sessionId, targetTitle: item.title }],
      );
    }
    setText((prev) => {
      if (!ta) return prev;
      const caret = ta.selectionStart ?? prev.length;
      const before = prev.slice(0, caret);
      const token = atTokenRef.current;
      const atPos = before.lastIndexOf(`@${token}`);
      if (atPos === -1) return prev;
      const replacement = item.kind === "session" ? `@${item.title}` : item.path;
      return `${prev.slice(0, atPos)}${replacement} ${prev.slice(caret)}`;
    });
    requestAnimationFrame(() => taRef.current?.focus());
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (shuttingDown) {
      e.preventDefault();
      return;
    }
    const nativeEvent = e.nativeEvent;
    const sendShortcut = e.key === "Enter" && !e.shiftKey;
    const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
    const isComposing = isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;

    if (sendShortcut && (isComposing || recentlyComposed)) {
      e.preventDefault();
      return;
    }

    if (atOpen && atItems.length > 0 && !isComposing) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAtIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAtIndex((prev) => Math.min(atItems.length - 1, prev + 1));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAtOpen(false);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyAt(atItems[atIndex]);
        return;
      }
    }

    if (historyOpen && !isComposing) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHistoryIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHistoryIndex((prev) => Math.min(inputHistory.length - 1, prev + 1));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setHistoryOpen(false);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        applyHistory(inputHistory[historyIndex]);
        return;
      }
    }

    if (e.key === "ArrowUp" && !isComposing && !running && text.trim().length === 0 && inputHistory.length > 0) {
      e.preventDefault();
      setHistoryIndex(inputHistory.length - 1);
      setHistoryOpen(true);
      return;
    }

    if (sendShortcut) {
      e.preventDefault();
      send();
    }
  };

  const canSend = text.trim().length === 0 && attachments.length === 0;
  const queued = [...queuedMessages.steering, ...queuedMessages.followUp];

  return (
    <div className="omega-composer">
      <PlanReview />
      {historyOpen && inputHistory.length > 0 ? (
        <div id="omega-history-list" role="listbox" aria-label="输入历史" className="omega-composer-suggest">
          <div className="overline-label">{t("composer.historyTitle")}</div>
          {inputHistory.map((entry, index) => (
            <div
              id={`omega-history-option-${index}`}
              role="option"
              tabIndex={0}
              aria-selected={index === historyIndex}
              key={`${entry}-${index}`}
              className="omega-composer-option"
              onMouseDown={(e) => {
                e.preventDefault();
                applyHistory(entry);
              }}
            >
              <span className="omega-composer-option-text">{entry}</span>
            </div>
          ))}
        </div>
      ) : null}

      {atOpen && atItems.length > 0 ? (
        <div id="omega-at-list" role="listbox" aria-label="文件补全结果" className="omega-composer-suggest omega-composer-suggest-at">
          <div className="overline-label">{t("composer.atTitle")}</div>
          {atItems.map((item, index) => (
            <div
              id={`omega-at-option-${index}`}
              role="option"
              tabIndex={0}
              aria-selected={index === atIndex}
              key={item.kind === "session" ? `session-${item.sessionId}` : `file-${item.path}`}
              className="omega-composer-option omega-composer-option-at"
              onMouseDown={(e) => {
                e.preventDefault();
                applyAt(item);
              }}
            >
              {item.kind === "session" ? (
                <>
                  <span className="omega-composer-at-mark">@</span>
                  <span className="omega-composer-at-title">{item.title}</span>
                  <span className="omega-composer-at-detail">{t("composer.atSessionDetail")}</span>
                </>
              ) : (
                <span className="omega-composer-at-path">{item.path}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {composerError ? (
        <p id="omega-composer-error" role="alert" className="omega-error-text omega-composer-error">{composerError}</p>
      ) : null}

      {queued.length > 0 ? (
        <div className="omega-composer-queue">
          <span className="omega-composer-queue-label">队列 · {queued.length}</span>
          <div className="omega-composer-queue-list">
            {queuedMessages.steering.map((entry, index) => (
              <QueuedRow key={`s-${index}`} kind="steer" text={entry} />
            ))}
            {queuedMessages.followUp.map((entry, index) => (
              <QueuedRow key={`f-${index}`} kind="followUp" text={entry} />
            ))}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton size="sm" label={t("composer.recallAria")} onClick={() => void recallQueue()} disabled={shuttingDown}>
                <ReplayIcon />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>{t("composer.recallTooltip")}</TooltipContent>
          </Tooltip>
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="omega-composer-chips">
          {attachments.map((attachment) => (
            <span key={attachment.key} className="omega-chip omega-chip-dismiss">
              <span>{attachment.name}</span>
              <button type="button" className="omega-chip-dismiss-btn" aria-label={`移除 ${attachment.name}`} onClick={() => onDelete(attachment.key)}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="omega-composer-shell">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="omega-file-input"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          ref={taRef}
          id="omega-composer-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={atOpen || historyOpen}
          aria-controls={atOpen ? "omega-at-list" : historyOpen ? "omega-history-list" : undefined}
          aria-activedescendant={atOpen && atItems[atIndex] ? `omega-at-option-${atIndex}` : historyOpen && inputHistory[historyIndex] ? `omega-history-option-${historyIndex}` : undefined}
          aria-describedby={composerError ? "omega-composer-error" : undefined}
          rows={1}
          value={text}
          disabled={shuttingDown}
          className="omega-composer-input"
          onChange={(e) => {
            setText(e.target.value);
            setHistoryOpen(false);
            detectAtToken(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
            lastCompositionEndAtRef.current = Date.now();
          }}
          placeholder={running ? t("composer.placeholderRunning") : t("composer.placeholder")}
        />
        <div className="omega-composer-toolbar">
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton size="lg" className="omega-composer-action" label={t("composer.commandPaletteAria")} onClick={() => setCommandPaletteOpen(true)} disabled={shuttingDown}>
                <CommandIcon />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>{t("composer.commandPaletteTooltip")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                size="lg"
                className="omega-composer-action"
                label={t("composer.attachAria")}
                onClick={() => fileRef.current?.click()}
                disabled={shuttingDown || attachments.length >= MAX_IMAGES}
              >
                <AttachFile />
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>{t("composer.attachTooltip", { n: MAX_IMAGES })}</TooltipContent>
          </Tooltip>
          <div className="omega-composer-toolbar-spacer" />
          {running ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    className="omega-composer-steer"
                    label={t("composer.steerAria")}
                    onClick={() => send("steer")}
                    disabled={shuttingDown || canSend}
                  >
                    <BoltIcon />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent>{t("composer.steerTooltip")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    className="omega-composer-stop"
                    label={t("composer.stopAria")}
                    onClick={() => void abort()}
                    disabled={shuttingDown}
                  >
                    <StopIcon />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent>彻底停止生成</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <IconButton
              className="omega-composer-send"
              label={t("composer.sendAria")}
              onClick={() => send()}
              disabled={shuttingDown || canSend}
            >
              <SendIcon />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}
