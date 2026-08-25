import * as React from "react";
import Dialog from "@mui/material/Dialog";
import TextField from "@mui/material/TextField";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Box from "@mui/material/Box";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { SlashCommandInfo } from "../../types/dto";

type PaletteItem =
  | { kind: "ui"; id: string; title: string; description: string; run: () => void }
  | { kind: "command"; command: SlashCommandInfo };

function commandLabel(command: SlashCommandInfo): string {
  return command.name.startsWith("/") ? command.name : `/${command.name}`;
}

export function CommandPalette(): React.ReactElement {
  const open = useAppStore((s) => s.layout.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  const setConnection = useAppStore((s) => s.setConnection);
  const setAgent = useAppStore((s) => s.setAgent);
  const setModelCenterOpen = useAppStore((s) => s.setModelCenterOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setResourceCenterOpen = useAppStore((s) => s.setResourceCenterOpen);
  const setTreeOpen = useAppStore((s) => s.setTreeOpen);
  const commands = useAppStore((s) => s.commands);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setError(null);
    void ipc.listCommands().then((res) => {
      if (res.ok) useAppStore.getState().setCommands(res.data);
      else setError(res.message);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [open]);

  const uiItems = React.useMemo<Array<Extract<PaletteItem, { kind: "ui" }>>>(
    () => [
      {
        kind: "ui",
        id: "model-center",
        title: "打开模型中心",
        description: "配置提供商 API key 并选择模型",
        run: () => setModelCenterOpen(true),
      },
      {
        kind: "ui",
        id: "settings",
        title: "打开设置",
        description: "Agent 行为、后台会话上限和桌面偏好",
        run: () => setSettingsOpen(true),
      },
      {
        kind: "ui",
        id: "resource-center",
        title: "打开资源中心",
        description: "查看、启用/禁用、本地安装并重载扩展与 skills",
        run: () => setResourceCenterOpen(true),
      },
      {
        kind: "ui",
        id: "tree",
        title: "打开会话分支树",
        description: "查看、预览并回退当前会话分支",
        run: () => setTreeOpen(true),
      },
      {
        kind: "ui",
        id: "clone",
        title: "复制当前分支",
        description: "在当前位置创建独立 session",
        run: () => {
          void (async () => {
            const res = await ipc.clone();
            if (!res.ok) {
              useAppStore.getState().setComposerError(res.message);
              return;
            }
            useAppStore.getState().setActiveSession(res.data.record.id);
            useAppStore.getState().loadTranscript(res.data.record);
            const state = await ipc.getState();
            if (state.ok) useAppStore.getState().setAgent(state.data);
            const list = await ipc.listSessions();
            if (list.ok) useAppStore.getState().applySessionPage(list.data);
          })();
        },
      },
      {
        kind: "ui",
        id: "worktree",
        title: "打开工作树",
        description: "查看、创建和删除 Git worktree 副本",
        run: () => useAppStore.getState().setRightTab("worktree"),
      },
    ],
    [setModelCenterOpen, setSettingsOpen, setResourceCenterOpen, setTreeOpen],
  );

  const items = React.useMemo(() => {
    const hay = query.trim().toLowerCase();
    const desktop = uiItems.filter((item) => !hay || `${item.title} ${item.description} ${item.id}`.toLowerCase().includes(hay));
    const commandItems: PaletteItem[] = commands
      .filter((command) => {
        const label = `${commandLabel(command)} ${command.description} ${command.source}`;
        return !hay || label.toLowerCase().includes(hay);
      })
      .map((command) => ({ kind: "command", command }));
    return [...desktop, ...commandItems];
  }, [commands, query, uiItems]);

  const runCommand = React.useCallback(
    async (command: SlashCommandInfo) => {
      setOpen(false);
      if (command.action === "compact") {
        const res = await ipc.compact();
        if (res.ok) setAgent(res.data);
        return;
      }
      if (command.action === "new") {
        const record = await ipc.newSession({});
        if (record.ok) {
          useAppStore.getState().setActiveSession(record.data.id);
          useAppStore.getState().loadTranscript(record.data);
          const list = await ipc.listSessions();
          if (list.ok) useAppStore.getState().applySessionPage(list.data);
        }
        return;
      }
      setConnection("running");
      try {
        const res = await ipc.prompt(commandLabel(command));
        if (!res.ok) {
          useAppStore.getState().setComposerError(`${res.code}: ${res.message ?? "未知错误"}`);
          useAppStore.getState().setConnection("ready");
        }
      } catch (error) {
        console.error("command failed", error);
        useAppStore.getState().setConnection("ready");
      }
    },
    [setOpen, setConnection, setAgent],
  );

  const runItem = React.useCallback(
    (item: PaletteItem) => {
      if (item.kind === "ui") {
        setOpen(false);
        item.run();
        return;
      }
      void runCommand(item.command);
    },
    [runCommand, setOpen],
  );

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          overflow: "hidden",
          animation: "omega-rise .18s var(--omega-ease-out, cubic-bezier(0.22,1,0.36,1)) both",
        },
      }}
    >
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="搜索桌面操作"
          placeholder="搜索桌面操作或 / 命令…"
          value={query}
          aria-controls="omega-command-list"
          aria-activedescendant={items[activeIndex] ? `omega-command-${activeIndex}` : undefined}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((index) => Math.min(Math.max(items.length - 1, 0), index + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
            else if (e.key === "Home") { e.preventDefault(); setActiveIndex(0); }
            else if (e.key === "End") { e.preventDefault(); setActiveIndex(Math.max(items.length - 1, 0)); }
            else if (e.key === "Enter" && items[activeIndex]) { e.preventDefault(); runItem(items[activeIndex]); }
          }}
        />
        {error ? <Box role="alert" sx={{ color: "var(--omega-danger)", fontSize: 12, mt: 0.75 }}>{error}</Box> : null}
      </Box>
      <List id="omega-command-list" role="listbox" aria-label="桌面操作列表" sx={{ px: 1.25, pb: 1.25, pt: 0, maxHeight: 420 }}>
        {items.map((item, index) =>
          item.kind === "ui" ? (
              <ListItemButton
              id={`omega-command-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              selected={index === activeIndex}
              key={item.id}
              onClick={() => runItem(item)}
              sx={{
                borderRadius: "9px",
                mb: 0.25,
                border: "1px solid transparent",
                "&:hover": { borderColor: "var(--omega-border)" },
                ...(index === activeIndex ? { background: "var(--omega-selected)", borderColor: "var(--omega-accent-line)" } : null),
              }}
            >
              <ListItemText
                primary={<span style={{ fontSize: 13, color: "var(--omega-text)", fontWeight: 600 }}>{item.title}</span>}
                secondary={<span style={{ fontSize: 12, color: "var(--omega-text-muted)" }}>{item.description}</span>}
              />
              {index === activeIndex ? <kbd className="kbd">↵</kbd> : null}
            </ListItemButton>
          ) : (
            <ListItemButton
              id={`omega-command-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              selected={index === activeIndex}
              key={`${item.command.source}:${item.command.name}`}
              onClick={() => runItem(item)}
              sx={{
                borderRadius: "9px",
                mb: 0.25,
                border: "1px solid transparent",
                "&:hover": { borderColor: "var(--omega-border)" },
                ...(index === activeIndex ? { background: "var(--omega-selected)", borderColor: "var(--omega-accent-line)" } : null),
              }}
            >
              <ListItemText
                primary={<span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, fontWeight: 600, color: "var(--omega-accent)" }}>{commandLabel(item.command)}</span>}
                secondary={<span style={{ fontSize: 12, color: "var(--omega-text-muted)" }}>{item.command.description || item.command.source}</span>}
              />
              {index === activeIndex ? <kbd className="kbd">↵</kbd> : null}
            </ListItemButton>
          ),
        )}
        {items.length === 0 ? (
          <ListItemText primary={<span style={{ fontSize: 12, color: "var(--omega-text-dim)", padding: "8px" }}>无匹配命令</span>} />
        ) : null}
      </List>
    </Dialog>
  );
}
