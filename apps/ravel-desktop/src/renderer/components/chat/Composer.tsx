import * as React from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import TextareaAutosize from "@mui/material/TextareaAutosize";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import BoltIcon from "@mui/icons-material/Bolt";
import ReplayIcon from "@mui/icons-material/Replay";
import KeyboardCommandKeyIcon from "@mui/icons-material/KeyboardCommandKey";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { userMessageKey } from "../../lib/prompt-recovery";
import { clearDraft, getDraft, mergeDraftText, setDraft, type DraftImage } from "../../lib/draft-store";
import type { PromptImage } from "../../types/dto";

const MAX_IMAGES = 4;
/** IME composition guard (port of pi-web, MIT): keyCode 229 + 100ms post-composition grace. */
const COMPOSITION_END_ENTER_GRACE_MS = 100;

interface Attachment extends PromptImage {
  key: string;
  name: string;
}

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

function QueuedRow({ kind, text }: { kind: "steer" | "followUp"; text: string }): React.ReactElement {
  const isSteer = kind === "steer";
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.25, minWidth: 0 }}>
      <Chip
        size="small"
        label={isSteer ? "插入当前轮" : "后续消息"}
        sx={{
          flex: "0 0 auto",
          height: 18,
          fontSize: 10.5,
          fontFamily: "ui-monospace, Consolas, monospace",
          borderRadius: 999,
          border: isSteer ? "1px solid var(--omega-accent)" : "1px solid var(--omega-border)",
          color: isSteer ? "var(--omega-accent)" : "var(--omega-text-muted)",
          background: "transparent",
        }}
      />
      <Typography title={text} sx={{ fontSize: 12, color: "var(--omega-text-muted)", minWidth: 0 }} noWrap>
        {truncate(text)}
      </Typography>
    </Box>
  );
}

export function Composer(): React.ReactElement {
  const [text, setText] = React.useState("");
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyIndex, setHistoryIndex] = React.useState(0);
  const [atItems, setAtItems] = React.useState<string[]>([]);
  const [atOpen, setAtOpen] = React.useState(false);
  const [atIndex, setAtIndex] = React.useState(0);
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
      setText("");
      setHistoryOpen(false);
      setAttachments([]);
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
          const res = await ipc.prompt(payload, behavior ?? (running ? "followUp" : undefined), images.length > 0 ? images : undefined, clientMessageId);
          if (!res.ok) {
            const agentStarted = useAppStore.getState().lastAgentStartAt >= sentAt;
            useAppStore.getState().dropLastIfOptimistic(key);
            if (!agentStarted) {
              // Deterministic early rejection: give the text back.
              setText((prev) => mergeDraftText(value || "（请查看图片）", prev));
              setAttachments((prev) => [...prev, ...attachments].slice(0, MAX_IMAGES));
              setConnection("ready");
            }
            setComposerError(`${res.code}: ${res.message ?? "未知错误"}`);
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
    [text, attachments, running, shuttingDown, setConnection, setComposerError, runBash],
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

  // `@` file completion: query the main-process index with a small debounce.
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
    setAtItems([]);
    setAtIndex(0);
    window.clearTimeout(atTimerRef.current);
    atTimerRef.current = window.setTimeout(() => {
      void ipc.fileIndex({ query: token }).then((res) => {
        if (requestId !== atRequestRef.current || atTokenRef.current !== token) return;
        if (res.ok) {
          setAtItems(res.data);
          if (res.data.length === 0) setAtOpen(false);
        }
      });
    }, 150);
  }, []);

  React.useEffect(() => () => window.clearTimeout(atTimerRef.current), []);

  const applyAt = React.useCallback((path: string) => {
    const ta = taRef.current;
    setAtOpen(false);
    setText((prev) => {
      if (!ta) return prev;
      const caret = ta.selectionStart ?? prev.length;
      const before = prev.slice(0, caret);
      const token = atTokenRef.current;
      const atPos = before.lastIndexOf(`@${token}`);
      if (atPos === -1) return prev;
      return `${prev.slice(0, atPos)}@${path} ${prev.slice(caret)}`;
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
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        mx: 2,
        mb: 2,
        position: "relative",
      }}
    >
      {historyOpen && inputHistory.length > 0 ? (        <Paper id="omega-history-list" role="listbox" aria-label="输入历史"
          elevation={0}
          sx={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            right: 0,
            maxHeight: 260,
            overflowY: "auto",
            border: "1px solid var(--omega-border-strong)",
            borderRadius: "12px",
            background: "var(--omega-bg-overlay)",
            boxShadow: "var(--omega-shadow-lg), var(--omega-inset-highlight)",
            p: 0.75,
            zIndex: 20,
          }}
        >
          <Typography className="overline-label" sx={{ px: 1, py: 0.5 }}>
            输入历史（↑↓ 选择，Enter 应用）
          </Typography>
          {inputHistory.map((entry, index) => (
            <Box
              id={`omega-history-option-${index}`}
              role="option"
              aria-selected={index === historyIndex}
              key={`${entry}-${index}`}
              onMouseDown={(e) => {
                e.preventDefault();
                applyHistory(entry);
              }}
              sx={{
                px: 1.25,
                py: 0.6,
                borderRadius: "8px",
                cursor: "pointer",
                background: index === historyIndex ? "var(--omega-selected)" : "transparent",
                "&:hover": { background: "var(--omega-hover-fill)" },
              }}
            >
              <Typography sx={{ fontSize: 13, color: "var(--omega-text)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {entry}
              </Typography>
            </Box>
          ))}
        </Paper>
      ) : null}

      {atOpen && atItems.length > 0 ? (
        <Paper id="omega-at-list" role="listbox" aria-label="文件补全结果"
          elevation={0}
          sx={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            right: 0,
            maxHeight: 220,
            overflowY: "auto",
            border: "1px solid var(--omega-border-strong)",
            borderRadius: "12px",
            background: "var(--omega-bg-overlay)",
            boxShadow: "var(--omega-shadow-lg), var(--omega-inset-highlight)",
            p: 0.75,
            zIndex: 20,
          }}
        >
          <Typography className="overline-label" sx={{ px: 1, py: 0.5 }}>
            文件（@ 引用，↑↓ 选择）
          </Typography>
          {atItems.map((path, index) => (
            <Box
              id={`omega-at-option-${index}`}
              role="option"
              aria-selected={index === atIndex}
              key={path}
              onMouseDown={(e) => {
                e.preventDefault();
                applyAt(path);
              }}
              sx={{
                px: 1.25,
                py: 0.5,
                borderRadius: "8px",
                cursor: "pointer",
                background: index === atIndex ? "var(--omega-selected)" : "transparent",
                "&:hover": { background: "var(--omega-hover-fill)" },
              }}
            >
              <Typography sx={{ fontSize: 12, fontFamily: "ui-monospace, Consolas, monospace", color: "var(--omega-text)" }} noWrap>
                {path}
              </Typography>
            </Box>
          ))}
        </Paper>
      ) : null}

      {composerError ? (
        <Typography id="omega-composer-error" role="alert" sx={{ fontSize: 12, color: "var(--omega-danger)", px: 1, pb: 0.75 }}>{composerError}</Typography>
      ) : null}

      {queued.length > 0 ? (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            px: 1,
            pb: 0.75,
            border: "1px solid var(--omega-border)",
            borderRadius: "12px",
            mb: 0.75,
            background: "var(--omega-bg-soft)",
          }}
        >
          <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: "var(--omega-text-muted)", flex: "0 0 auto", pr: 1 }}>
            队列 · {queued.length}
          </Typography>
          <Box sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            {queuedMessages.steering.map((entry, index) => (
              <QueuedRow key={`s-${index}`} kind="steer" text={entry} />
            ))}
            {queuedMessages.followUp.map((entry, index) => (
              <QueuedRow key={`f-${index}`} kind="followUp" text={entry} />
            ))}
          </Box>
          <Tooltip title="撤回全部排队消息到输入框">
            <IconButton size="small" aria-label="撤回全部排队消息" onClick={() => void recallQueue()} disabled={shuttingDown} sx={{ color: "var(--omega-text-muted)", "&:hover": { color: "var(--omega-accent)" } }}>
              <ReplayIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ) : null}

      {attachments.length > 0 ? (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, px: 1, pb: 0.75 }}>
          {attachments.map((attachment) => (
            <Chip
              key={attachment.key}
              size="small"
              label={attachment.name}
              onDelete={() => setAttachments((prev) => prev.filter((item) => item.key !== attachment.key))}
              sx={{ maxWidth: 220, "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" } }}
            />
          ))}
        </Box>
      ) : null}

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 0.5,
          p: 1,
          minWidth: 0,
          border: "1px solid var(--omega-border)",
          borderRadius: "16px",
          background: "var(--omega-composer-bg)",
          backdropFilter: "blur(18px) saturate(1.4)",
          WebkitBackdropFilter: "blur(18px) saturate(1.4)",
          boxShadow: "var(--omega-shadow-md), var(--omega-inset-highlight)",
          transition: "border-color 160ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)), box-shadow 160ms var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1))",
          "&:focus-within": {
            borderColor: "var(--omega-accent-line)",
            boxShadow: "var(--omega-shadow-md), 0 0 0 3px var(--omega-accent-soft), var(--omega-glow-accent)",
          },
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <TextareaAutosize
          ref={taRef as never}
          id="omega-composer-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={atOpen || historyOpen}
          aria-controls={atOpen ? "omega-at-list" : historyOpen ? "omega-history-list" : undefined}
          aria-activedescendant={atOpen && atItems[atIndex] ? `omega-at-option-${atIndex}` : historyOpen && inputHistory[historyIndex] ? `omega-history-option-${historyIndex}` : undefined}
          aria-describedby={composerError ? "omega-composer-error" : undefined}
          value={text}
          disabled={shuttingDown}
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
          placeholder={running ? "生成中，输入后排队发送…" : "输入消息…"}
          minRows={1}
          maxRows={8}
          style={{
            width: "100%",
            minWidth: 0,
            resize: "none",
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--omega-text)",
            font: "inherit",
            fontSize: 14,
            lineHeight: 1.6,
            padding: "6px 8px 2px",
            boxSizing: "border-box",
          }}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, minWidth: 0, px: 0.25 }}>
          <Tooltip title="命令面板（Ctrl+K）">
            <IconButton size="small" aria-label="打开命令面板" onClick={() => setCommandPaletteOpen(true)} disabled={shuttingDown} sx={{ color: "var(--omega-text-muted)", flex: "0 0 auto", minWidth: 40, minHeight: 40 }}>
              <KeyboardCommandKeyIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="附加图片（最多 4 张）">
            <IconButton
              size="small"
              aria-label="附加图片"
              onClick={() => fileRef.current?.click()}
              disabled={shuttingDown || attachments.length >= MAX_IMAGES}
              sx={{ color: "var(--omega-text-muted)", flex: "0 0 auto", minWidth: 40, minHeight: 40 }}
            >
              <AttachFileIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Box sx={{ flex: 1, minWidth: 0 }} />
          {running ? (
            <>
              <Tooltip title="打断当前生成并插入这条消息（Steer）">
                <IconButton
                  aria-label="插入当前生成"
                  onClick={() => send("steer")}
                  disabled={shuttingDown || canSend}
                  sx={{
                    color: "var(--omega-warning)",
                    background: "var(--omega-warning-soft)",
                    borderRadius: "10px",
                    width: 34,
                    height: 34,
                    flex: "0 0 auto",
                    boxShadow: "var(--omega-inset-highlight)",
                    "&:disabled": { opacity: 0.45 },
                  }}
                >
                  <BoltIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="彻底停止生成">
                <IconButton
                  aria-label="停止生成"
                  onClick={() => void abort()}
                  disabled={shuttingDown}
                  sx={{
                    color: "var(--omega-danger)",
                    background: "var(--omega-danger-soft)",
                    borderRadius: "10px",
                    width: 34,
                    height: 34,
                    flex: "0 0 auto",
                    boxShadow: "var(--omega-inset-highlight)",
                  }}
                >
                  <StopIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <IconButton
              aria-label="发送消息"
              onClick={() => send()}
              disabled={shuttingDown || canSend}
              sx={{
                color: "var(--omega-accent-foreground)",
                background: "var(--omega-accent-gradient)",
                borderRadius: "10px",
                width: 40,
                height: 40,
                minWidth: 40,
                minHeight: 40,
                flex: "0 0 auto",
                boxShadow: "0 2px 8px var(--omega-accent-soft), var(--omega-inset-highlight), var(--omega-glow-accent)",
                transition: "transform 120ms var(--omega-ease-out), box-shadow 120ms var(--omega-ease-out), filter 120ms var(--omega-ease-out)",
                "&:hover": { filter: "brightness(1.08)", transform: "translateY(-0.5px)", boxShadow: "0 4px 14px var(--omega-accent-soft), var(--omega-inset-highlight), 0 0 20px rgba(232, 180, 74, 0.40)" },
                "&:active": { transform: "translateY(0.5px)" },
                "&:disabled": { opacity: 0.4, background: "var(--omega-border-strong)", boxShadow: "none", color: "var(--omega-text-dim)" },
              }}
            >
              <SendIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
      </Box>
    </Box>
  );
}
