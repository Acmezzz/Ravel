import * as React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
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

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    void ipc.listCommands().then((res) => {
      if (res.ok) useAppStore.getState().setCommands(res.data);
    });
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
        title: "打开 Worktree",
        description: "查看、创建和删除 Git worktree",
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
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>命令面板</DialogTitle>
      <Box sx={{ px: 3, pb: 1 }}>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="搜索桌面操作或 / 命令…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && items[0]) runItem(items[0]);
          }}
        />
      </Box>
      <List sx={{ px: 2, pb: 2, pt: 0 }}>
        {items.map((item) =>
          item.kind === "ui" ? (
            <ListItemButton key={item.id} onClick={() => runItem(item)} sx={{ borderRadius: "10px", mb: 0.5 }}>
              <ListItemText
                primary={<span style={{ fontSize: 13, color: "var(--omega-text)", fontWeight: 600 }}>{item.title}</span>}
                secondary={<span style={{ fontSize: 12, color: "var(--omega-text-muted)" }}>{item.description}</span>}
              />
            </ListItemButton>
          ) : (
            <ListItemButton key={`${item.command.source}:${item.command.name}`} onClick={() => runItem(item)} sx={{ borderRadius: "10px", mb: 0.5 }}>
              <ListItemText
                primary={<span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "var(--omega-accent)" }}>{commandLabel(item.command)}</span>}
                secondary={<span style={{ fontSize: 12, color: "var(--omega-text-muted)" }}>{item.command.description || item.command.source}</span>}
              />
            </ListItemButton>
          ),
        )}
        {items.length === 0 ? (
          <ListItemText primary={<span style={{ fontSize: 12, color: "var(--omega-text-dim)" }}>无匹配命令</span>} />
        ) : null}
      </List>
    </Dialog>
  );
}
