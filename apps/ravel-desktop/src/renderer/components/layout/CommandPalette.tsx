import * as React from "react";
import { Dialog, DialogContent, DialogContentArea, DialogTitle } from "../../ui/Dialog";
import { useAppStore } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";
import { ipc } from "../../ipc/client";
import type { SlashCommandInfo } from "../../types/dto";

type PaletteItem =
  | { kind: "ui"; id: string; title: string; description: string; run: () => void }
  | { kind: "command"; command: SlashCommandInfo };

function commandLabel(command: SlashCommandInfo): string {
  return command.name.startsWith("/") ? command.name : `/${command.name}`;
}

export function CommandPalette(): React.ReactElement {
  const t = useT();
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
        title: t("palette.modelCenter.title"),
        description: t("palette.modelCenter.desc"),
        run: () => setModelCenterOpen(true),
      },
      {
        kind: "ui",
        id: "settings",
        title: t("palette.settings.title"),
        description: t("palette.settings.desc"),
        run: () => setSettingsOpen(true),
      },
      {
        kind: "ui",
        id: "resource-center",
        title: t("palette.resourceCenter.title"),
        description: t("palette.resourceCenter.desc"),
        run: () => setResourceCenterOpen(true),
      },
      {
        kind: "ui",
        id: "tree",
        title: t("palette.tree.title"),
        description: t("palette.tree.desc"),
        run: () => setTreeOpen(true),
      },
      {
        kind: "ui",
        id: "clone",
        title: t("palette.clone.title"),
        description: t("palette.clone.desc"),
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
        title: t("palette.worktree.title"),
        description: t("palette.worktree.desc"),
        run: () => useAppStore.getState().setRightTab("worktree"),
      },
    ],
    [setModelCenterOpen, setSettingsOpen, setResourceCenterOpen, setTreeOpen, t],
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
          useAppStore.getState().setComposerError(`${res.code}: ${res.message ?? t("common.unknownError")}`);
          useAppStore.getState().setConnection("ready");
        }
      } catch (error) {
        console.error("command failed", error);
        useAppStore.getState().setConnection("ready");
      }
    },
    [setOpen, setConnection, setAgent, t],
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="omega-dialog-command-palette">
        <DialogTitle>{t("palette.search")}</DialogTitle>
        <DialogContentArea className="omega-model-picker-search">
          <label className="omega-field" htmlFor="omega-command-search">
            <span className="omega-field-label">{t("palette.search")}</span>
            <input
              id="omega-command-search"
              className="omega-input"
              autoFocus
              placeholder={t("palette.searchPlaceholder")}
              value={query}
              aria-controls="omega-command-list"
              aria-activedescendant={items[activeIndex] ? `omega-command-${activeIndex}` : undefined}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(Math.max(items.length - 1, 0), index + 1)); }
                else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
                else if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); }
                else if (event.key === "End") { event.preventDefault(); setActiveIndex(Math.max(items.length - 1, 0)); }
                else if (event.key === "Enter" && items[activeIndex]) { event.preventDefault(); runItem(items[activeIndex]); }
              }}
            />
          </label>
          {error ? <p role="alert" className="omega-error-text">{error}</p> : null}
        </DialogContentArea>
        <div id="omega-command-list" role="listbox" aria-label={t("palette.listAria")} className="omega-model-list omega-command-list">
          {items.map((item, index) =>
            item.kind === "ui" ? (
              <button
                type="button"
                id={`omega-command-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                key={item.id}
                onClick={() => runItem(item)}
                className="omega-menu-item omega-model-option omega-command-option"
              >
                <span className="omega-model-copy">
                  <span>{item.title}</span>
                  <small>{item.description}</small>
                </span>
                {index === activeIndex ? <kbd className="kbd">↵</kbd> : null}
              </button>
            ) : (
              <button
                type="button"
                id={`omega-command-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                key={`${item.command.source}:${item.command.name}`}
                onClick={() => runItem(item)}
                className="omega-menu-item omega-model-option omega-command-option"
              >
                <span className="omega-model-copy">
                  <span className="omega-command-label">{commandLabel(item.command)}</span>
                  <small>{item.command.description || item.command.source}</small>
                </span>
                {index === activeIndex ? <kbd className="kbd">↵</kbd> : null}
              </button>
            ),
          )}
          {items.length === 0 ? <p className="omega-muted-text">{t("palette.noMatch")}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
