import * as React from "react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/Dialog";
import { Switch } from "../../ui/Switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/Tabs";
import { TextField } from "../../ui/TextField";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { useT } from "../../lib/i18n";
import type { ResourceBundle } from "../../types/dto";

const MODE_KEY: Record<"all" | "one-at-a-time", "settings.mode.all" | "settings.mode.oneAtATime"> = {
	all: "settings.mode.all",
	"one-at-a-time": "settings.mode.oneAtATime",
};

const PERMISSION_KEY = {
	trusted: "settings.permission.trusted",
	"workspace-only": "settings.permission.workspaceOnly",
	"read-only": "settings.permission.readOnly",
	"ask-before-command": "settings.permission.askBeforeCommand",
} as const;

type PermissionProfile = keyof typeof PERMISSION_KEY;

const DEFAULT_KEYBINDINGS = {
	commandPalette: "Ctrl+K",
	newSession: "Ctrl+Shift+N",
	abort: "Escape",
	zoomIn: "Ctrl+=",
	zoomOut: "Ctrl+-",
	zoomReset: "Ctrl+0",
};

function Chip({ children }: { children: React.ReactNode }): React.ReactElement {
	return <span className="omega-chip">{children}</span>;
}

function ResourceGroup({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
	return (
		<section className="omega-form-stack">
			<h3 className="overline-label">{title}</h3>
			{children}
		</section>
	);
}

export interface SettingsDialogProps {
	open: boolean;
	onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps): React.ReactElement {
	const t = useT();
	const agent = useAppStore((s) => s.agent);
	const setAgent = useAppStore((s) => s.setAgent);
	const desktopSettings = useAppStore((s) => s.desktopSettings);
	const setDesktopSettings = useAppStore((s) => s.setDesktopSettings);
	const setModelCenterOpen = useAppStore((s) => s.setModelCenterOpen);
	const setResourceCenterOpen = useAppStore((s) => s.setResourceCenterOpen);
	const setTrustCenterOpen = useAppStore((s) => s.setTrustCenterOpen);
	const workspaceEpoch = useAppStore((s) => s.workspaceEpoch);

	const [activeTab, setActiveTab] = React.useState<"agent" | "desktop" | "resources">("agent");
	const [resources, setResources] = React.useState<ResourceBundle | null>(null);
	const [workerCap, setWorkerCap] = React.useState(String(desktopSettings?.workerCap ?? 3));
	const [idleTtl, setIdleTtl] = React.useState(String(Math.round((desktopSettings?.workerIdleTtlMs ?? 300_000) / 60_000)));
	const [keybindings, setKeybindings] = React.useState(desktopSettings?.keybindings ?? DEFAULT_KEYBINDINGS);
	const [desktopError, setDesktopError] = React.useState<string | null>(null);
	const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved">("idle");
	const [resourceQuery, setResourceQuery] = React.useState("");

	/** Case-insensitive match against name/description/path for resource lists. */
	const matchesResource = React.useCallback(
		(fields: Array<string | undefined | null>) => {
			const q = resourceQuery.trim().toLowerCase();
			if (!q) return true;
			return fields.some((field) => (field ?? "").toLowerCase().includes(q));
		},
		[resourceQuery],
	);

	React.useEffect(() => {
		if (!open) return;
		setWorkerCap(String(desktopSettings?.workerCap ?? 3));
		setIdleTtl(String(Math.round((desktopSettings?.workerIdleTtlMs ?? 300_000) / 60_000)));
		setKeybindings(desktopSettings?.keybindings ?? DEFAULT_KEYBINDINGS);
		setDesktopError(null);
	}, [open, desktopSettings]);

	React.useEffect(() => {
		if (!open) {
			setResources(null);
			setResourceQuery("");
			return;
		}
		void ipc.listResources().then((res) => {
			if (res.ok) setResources(res.data);
		});
	}, [open, workspaceEpoch]);

	const apply = React.useCallback(
		async (patch: {
			steeringMode?: "all" | "one-at-a-time";
			followUpMode?: "all" | "one-at-a-time";
			autoCompaction?: boolean;
			autoRetry?: boolean;
		}) => {
			setSaveState("saving");
			try {
				const res = await ipc.updateSettings(patch);
				if (res.ok) {
					setAgent(res.data);
					setSaveState("saved");
				} else {
					setDesktopError(res.message);
					setSaveState("idle");
				}
			} catch (reason) {
				setDesktopError(reason instanceof Error ? reason.message : String(reason));
				setSaveState("idle");
			}
		},
		[setAgent],
	);

	const applyDesktopPatch = React.useCallback(
		async (patch: Parameters<typeof ipc.updateDesktopSettings>[0]) => {
			setSaveState("saving");
			try {
				const res = await ipc.updateDesktopSettings(patch);
				if (res.ok) {
					setDesktopSettings(res.data);
					setDesktopError(null);
					setSaveState("saved");
				} else {
					setDesktopError(res.message);
					setSaveState("idle");
				}
			} catch (reason) {
				setDesktopError(reason instanceof Error ? reason.message : String(reason));
				setSaveState("idle");
			}
		},
		[setDesktopSettings],
	);

	const applyDesktop = React.useCallback(async () => {
		const cap = Number.parseInt(workerCap, 10);
		const minutes = Number.parseInt(idleTtl, 10);
		if (!Number.isInteger(cap) || cap < 1 || cap > 8) {
			setDesktopError(t("settings.error.workerCap"));
			return;
		}
		if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
			setDesktopError(t("settings.error.idleTtl"));
			return;
		}
		await applyDesktopPatch({
			workerCap: cap,
			workerIdleTtlMs: minutes * 60_000,
		});
	}, [applyDesktopPatch, workerCap, idleTtl, t]);

	const openCenter = (openFn: (next: boolean) => void) => {
		onClose();
		openFn(true);
	};

	const matchedExtensions = resources?.extensions.filter((extension) => matchesResource([extension.name, extension.path])) ?? [];
	const matchedSkills = resources?.skills.filter((skill) => matchesResource([skill.name, skill.description])) ?? [];
	const matchedPrompts = resources?.prompts.filter((promptResource) => matchesResource([promptResource.name, promptResource.description])) ?? [];

	return (
		<Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
			<DialogContent className="omega-dialog-wide">
				<DialogHeader>
					<DialogTitle>{t("settings.title")}</DialogTitle>
				</DialogHeader>
				<Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="omega-settings-tabs">
					<TabsList>
						<TabsTrigger value="agent">{t("settings.tab.agent")}</TabsTrigger>
						<TabsTrigger value="desktop">{t("settings.tab.desktop")}</TabsTrigger>
						<TabsTrigger value="resources">{t("settings.tab.resources")}</TabsTrigger>
					</TabsList>
					<TabsContent value="agent" className="omega-dialog-content-area omega-settings-tab">
						<TextField
							select
							label={t("settings.steeringMode")}
							value={agent?.steeringMode ?? "all"}
							onChange={(event) => void apply({ steeringMode: event.target.value as "all" | "one-at-a-time" })}
						>
							{(Object.keys(MODE_KEY) as Array<"all" | "one-at-a-time">).map((mode) => (
								<option key={mode} value={mode}>{t(MODE_KEY[mode])}</option>
							))}
						</TextField>
						<TextField
							select
							label={t("settings.followUpMode")}
							value={agent?.followUpMode ?? "all"}
							onChange={(event) => void apply({ followUpMode: event.target.value as "all" | "one-at-a-time" })}
						>
							{(Object.keys(MODE_KEY) as Array<"all" | "one-at-a-time">).map((mode) => (
								<option key={mode} value={mode}>{t(MODE_KEY[mode])}</option>
							))}
						</TextField>
						<div className="omega-setting-row">
							<div>
								<strong>{t("settings.autoCompaction")}</strong>
								<span>{t("settings.autoCompactionHint")}</span>
							</div>
							<Switch checked={agent?.autoCompaction ?? true} onCheckedChange={(checked) => void apply({ autoCompaction: checked })} />
						</div>
						<div className="omega-setting-row">
							<div>
								<strong>{t("settings.autoRetry")}</strong>
								<span>{t("settings.autoRetryHint")}</span>
							</div>
							<Switch checked={agent?.autoRetry ?? true} onCheckedChange={(checked) => void apply({ autoRetry: checked })} />
						</div>
					</TabsContent>
					<TabsContent value="desktop" className="omega-dialog-content-area omega-settings-tab">
						<section className="omega-form-stack">
							<h3 className="overline-label">{t("settings.section.permission")}</h3>
							<TextField
								select
								label={t("settings.permissionProfile")}
								hint={t("settings.permissionHelper")}
								value={desktopSettings?.permissionProfile ?? "trusted"}
								onChange={(event) => {
									const profile = event.target.value as PermissionProfile;
									setSaveState("saving");
									void ipc.setPermissionProfile({ profile }).then((res) => {
										if (res.ok) {
											setDesktopSettings(res.data);
											setDesktopError(null);
											setSaveState("saved");
										} else {
											setDesktopError(res.message);
											setSaveState("idle");
										}
									}).catch((reason) => {
										setDesktopError(reason instanceof Error ? reason.message : String(reason));
										setSaveState("idle");
									});
								}}
							>
								{(Object.keys(PERMISSION_KEY) as PermissionProfile[]).map((value) => (
									<option key={value} value={value}>{t(PERMISSION_KEY[value])}</option>
								))}
							</TextField>
						</section>
						<section className="omega-form-stack">
							<h3 className="overline-label">{t("settings.section.keybindings")}</h3>
							<div className="omega-settings-grid">
								<TextField
									label={t("settings.kb.commandPalette")}
									value={keybindings.commandPalette}
									onChange={(event) => setKeybindings((current) => ({ ...current, commandPalette: event.target.value }))}
									onBlur={() => void applyDesktopPatch({ keybindings })}
								/>
								<TextField
									label={t("settings.kb.newSession")}
									value={keybindings.newSession}
									onChange={(event) => setKeybindings((current) => ({ ...current, newSession: event.target.value }))}
									onBlur={() => void applyDesktopPatch({ keybindings })}
								/>
								<TextField
									label={t("settings.kb.abort")}
									value={keybindings.abort}
									onChange={(event) => setKeybindings((current) => ({ ...current, abort: event.target.value }))}
									onBlur={() => void applyDesktopPatch({ keybindings })}
								/>
								<TextField
									label={t("settings.kb.zoomIn")}
									value={keybindings.zoomIn}
									onChange={(event) => setKeybindings((current) => ({ ...current, zoomIn: event.target.value }))}
									onBlur={() => void applyDesktopPatch({ keybindings })}
								/>
								<TextField
									label={t("settings.kb.zoomOut")}
									value={keybindings.zoomOut}
									onChange={(event) => setKeybindings((current) => ({ ...current, zoomOut: event.target.value }))}
									onBlur={() => void applyDesktopPatch({ keybindings })}
								/>
								<TextField
									label={t("settings.kb.zoomReset")}
									value={keybindings.zoomReset}
									onChange={(event) => setKeybindings((current) => ({ ...current, zoomReset: event.target.value }))}
									onBlur={() => void applyDesktopPatch({ keybindings })}
								/>
							</div>
						</section>
						<section className="omega-form-stack">
							<h3 className="overline-label">{t("settings.section.runtime")}</h3>
							<div className="omega-settings-grid">
								<TextField
									select
									label={t("settings.language")}
									value={desktopSettings?.language ?? "zh-CN"}
									onChange={(event) => void applyDesktopPatch({ language: event.target.value as "zh-CN" | "en-US" })}
								>
									<option value="zh-CN">简体中文</option>
									<option value="en-US">English</option>
								</TextField>
								<TextField
									label={t("settings.workerCap")}
									value={workerCap}
									onChange={(event) => setWorkerCap(event.target.value)}
									onBlur={() => void applyDesktop()}
								/>
								<TextField
									label={t("settings.idleTtl")}
									value={idleTtl}
									onChange={(event) => setIdleTtl(event.target.value)}
									onBlur={() => void applyDesktop()}
								/>
							</div>
							{desktopError ? (
								<p role="alert" className="omega-error-text">{desktopError}</p>
							) : saveState === "saving" ? (
								<p role="status" aria-live="polite" className="omega-muted-text">{t("settings.saving")}</p>
							) : saveState === "saved" ? (
								<p role="status" aria-live="polite" className="omega-success-text">{t("settings.saved")}</p>
							) : null}
						</section>
						<div className="omega-button-row omega-settings-centers">
							<Button size="sm" onClick={() => openCenter(setModelCenterOpen)}>{t("settings.openModelCenter")}</Button>
							<Button size="sm" onClick={() => openCenter(setResourceCenterOpen)}>{t("settings.openResourceCenter")}</Button>
							<Button size="sm" onClick={() => openCenter(setTrustCenterOpen)}>{t("settings.openTrustCenter")}</Button>
						</div>
					</TabsContent>
					<TabsContent value="resources" className="omega-dialog-content-area omega-settings-tab">
						{agent?.projectTrusted === false ? <p className="omega-warning-text">{t("settings.untrustedProject")}</p> : null}
						{!resources ? (
							<p className="omega-muted-text">{t("settings.loadingResources")}</p>
						) : (
							<>
								<TextField
									label={t("settings.resourceSearch")}
									value={resourceQuery}
									onChange={(event) => setResourceQuery(event.target.value)}
									hint={resourceQuery.trim() ? t("settings.resourceFiltered") : undefined}
								/>
								<ResourceGroup title={`扩展（${matchedExtensions.length}/${resources.extensions.length}）`}>
									{resources.extensions.length === 0 ? <p className="omega-muted-text">{t("settings.extensionsEmpty")}</p> : null}
									{matchedExtensions.map((extension) => (
										<div key={extension.path} className="omega-settings-item">
											<strong>{extension.name}</strong>
											{extension.commands > 0 ? <Chip>{t("settings.chip.commands", { n: extension.commands })}</Chip> : null}
											{extension.tools > 0 ? <Chip>{t("settings.chip.tools", { n: extension.tools })}</Chip> : null}
											<span className="omega-settings-path" title={extension.path}>{extension.path}</span>
										</div>
									))}
									{resources.extensions.length > 0 && matchedExtensions.length === 0 ? <p className="omega-muted-text">{t("settings.extensionsNoMatch")}</p> : null}
								</ResourceGroup>
								<ResourceGroup title={t("settings.group.skills", { matched: matchedSkills.length, total: resources.skills.length })}>
									{resources.skills.length === 0 ? <p className="omega-muted-text">{t("settings.skillsEmpty")}</p> : null}
									{matchedSkills.map((skill) => (
										<div key={skill.filePath} className="omega-settings-item">
											<strong>/skill:{skill.name}</strong>
											<span className="omega-settings-path">{skill.description.slice(0, 60)}</span>
										</div>
									))}
									{resources.skills.length > 0 && matchedSkills.length === 0 ? <p className="omega-muted-text">{t("settings.skillsNoMatch")}</p> : null}
								</ResourceGroup>
								<ResourceGroup title={t("settings.group.prompts", { matched: matchedPrompts.length, total: resources.prompts.length })}>
									{resources.prompts.length === 0 ? <p className="omega-muted-text">{t("settings.promptsEmpty")}</p> : null}
									{matchedPrompts.map((promptResource) => (
										<div key={promptResource.filePath} className="omega-settings-item">
											<strong className="omega-settings-prompt">/{promptResource.name}</strong>
											{promptResource.argumentHint ? <Chip>{promptResource.argumentHint}</Chip> : null}
											<span className="omega-settings-path">{promptResource.description.slice(0, 60)}</span>
										</div>
									))}
									{resources.prompts.length > 0 && matchedPrompts.length === 0 ? <p className="omega-muted-text">{t("settings.promptsNoMatch")}</p> : null}
								</ResourceGroup>
							</>
						)}
					</TabsContent>
				</Tabs>
				<DialogFooter>
					<Button variant="solid" onClick={onClose}>{t("settings.done")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
