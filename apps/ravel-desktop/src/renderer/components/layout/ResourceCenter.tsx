import * as React from "react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../ui/Dialog";
import { Switch } from "../../ui/Switch";
import { TextField } from "../../ui/TextField";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import type { ConfiguredPackageInfo, ExtensionResource, McpBundle, McpServerRow, PromptResource, RegistryEntry, RegistryStagedResult, ResourceBundle, SkillResource } from "../../types/dto";

function scopeLabel(scope?: string): string { if (scope === "project") return "项目"; if (scope === "temporary") return "临时"; return "用户"; }
function Chip({ children, warning }: { children: React.ReactNode; warning?: boolean }): React.ReactElement { return <span className={warning ? "omega-chip omega-chip-warning" : "omega-chip"}>{children}</span>; }
function EmptyText({ children }: { children: React.ReactNode }): React.ReactElement { return <p className="omega-muted-text">{children}</p>; }

function ResourceRow({ title, subtitle, chips, enabled, dormant, busy, onToggle, extra }: { title: string; subtitle?: string; chips?: string[]; enabled: boolean; dormant?: boolean; busy: boolean; onToggle?: (enabled: boolean) => void; extra?: React.ReactNode }): React.ReactElement {
	return <div className="omega-resource-row"><div className="omega-resource-row-title"><strong title={title}>{title}</strong>{chips?.map((chip) => <Chip key={chip}>{chip}</Chip>)}{dormant ? <Chip warning>休眠</Chip> : null}{onToggle ? <Switch checked={enabled} disabled={busy || dormant} onCheckedChange={onToggle} /> : null}</div>{subtitle ? <span className="omega-resource-subtitle" title={subtitle}>{subtitle}</span> : null}{extra}</div>;
}

export function ResourceCenter(): React.ReactElement {
	const open = useAppStore((s) => s.layout.resourceCenterOpen);
	const setOpen = useAppStore((s) => s.setResourceCenterOpen);
	const workspaceEpoch = useAppStore((s) => s.workspaceEpoch);
	const [bundle, setBundle] = React.useState<ResourceBundle | null>(null);
	const [mcpBundle, setMcpBundle] = React.useState<McpBundle | null>(null);
	const [mcpFormOpen, setMcpFormOpen] = React.useState(false);
	const [mcpName, setMcpName] = React.useState("");
	const [mcpCommand, setMcpCommand] = React.useState("");
	const [mcpArgs, setMcpArgs] = React.useState("");
	const [mcpScopeProject, setMcpScopeProject] = React.useState(false);
	const [mcpTransport, setMcpTransport] = React.useState<"stdio" | "http">("stdio");
	const [mcpUrl, setMcpUrl] = React.useState("");
	const [mcpAuthUrl, setMcpAuthUrl] = React.useState("");
	const [mcpTokenUrl, setMcpTokenUrl] = React.useState("");
	const [mcpClientId, setMcpClientId] = React.useState("");
	const [removingMcp, setRemovingMcp] = React.useState<McpServerRow | null>(null);
	const [query, setQuery] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const [status, setStatus] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const load = React.useCallback(async () => { const res = await ipc.listResources(); if (res.ok) setBundle(res.data); else setError(res.message); const mcpRes = await ipc.mcpList(); if (mcpRes.ok) setMcpBundle(mcpRes.data); }, []);
	const applyMcp = React.useCallback(async (work: () => Promise<{ ok: boolean; data?: McpBundle; message?: string }>, okText: string) => { setBusy(true); setError(null); setStatus(null); try { const res = await work(); if (!res.ok) { setError(res.message ?? "操作失败"); return; } if (res.data) setMcpBundle(res.data); setStatus(okText); } finally { setBusy(false); } }, []);
	React.useEffect(() => { if (!open) { setQuery(""); setStatus(null); setError(null); setMcpFormOpen(false); setRemovingMcp(null); setRegistryFormOpen(false); setRegistryEntries(null); setRegistryStaged([]); return; } void load(); }, [open, workspaceEpoch, load]);
	const apply = React.useCallback(async (work: () => Promise<{ ok: boolean; data?: ResourceBundle; message?: string }>, okText: string) => { setBusy(true); setError(null); setStatus(null); try { const res = await work(); if (!res.ok) { setError(res.message ?? "操作失败"); return; } if (res.data) setBundle(res.data); setStatus(okText); } finally { setBusy(false); } }, []);
	const loginMcp = React.useCallback(async (server: McpServerRow) => {
		setBusy(true); setError(null); setStatus(null);
		try {
			const res = await ipc.mcpLogin({ name: server.name, project: server.scope === "project" });
			if (!res.ok) { setError(res.message ?? "OAuth 登录失败"); return; }
			const reloaded = await ipc.mcpList();
			if (reloaded.ok) setMcpBundle(reloaded.data);
			setStatus(`已保存 ${server.name} 的 OAuth 访问令牌（加密存储）`);
		} finally { setBusy(false); }
	}, []);
	const distillSkill = React.useCallback(async (skill: SkillResource) => {
		setBusy(true); setError(null); setStatus(null);
		try {
			const res = await ipc.histosDistillResource({ kind: "skill", name: skill.name, filePath: skill.filePath });
			if (!res.ok) { setError(res.message ?? "蒸馏失败"); return; }
			setStatus(`已生成 Histos 工件：graph @${res.data.graphSha256.slice(0, 12)}${res.data.contextSha256 ? `，ContextSet 草稿 @${res.data.contextSha256.slice(0, 12)}` : ""}`);
		} finally { setBusy(false); }
	}, []);
	const [remoteFormOpen, setRemoteFormOpen] = React.useState(false);
	const [remoteUrl, setRemoteUrl] = React.useState("");
	const [remoteStaged, setRemoteStaged] = React.useState<{ path: string; sha256: string; bytes: number; filename: string } | null>(null);
	const [registryFormOpen, setRegistryFormOpen] = React.useState(false);
	const [registryUrl, setRegistryUrl] = React.useState("");
	const [registryEntries, setRegistryEntries] = React.useState<RegistryEntry[] | null>(null);
	const [registryStaged, setRegistryStaged] = React.useState<RegistryStagedResult[]>([]);
	const stageRemote = React.useCallback(async () => {
		setBusy(true); setError(null); setStatus(null); setRemoteStaged(null);
		try {
			const res = await ipc.stageRemoteResource({ url: remoteUrl.trim() });
			if (!res.ok) { setError(res.message ?? "下载失败"); return; }
			setRemoteStaged(res.data);
		} finally { setBusy(false); }
	}, [remoteUrl]);
	const installRemote = React.useCallback(async (project: boolean) => {
		if (!remoteStaged) return;
		setRemoteFormOpen(false);
		await apply(() => ipc.installLocalResource({ source: remoteStaged.path, project }), "已从远程资源安装（来源已存 SHA-256 审阅记录）");
		setRemoteStaged(null);
		setRemoteUrl("");
	}, [apply, remoteStaged]);
	const fetchRegistry = React.useCallback(async () => {
		setBusy(true); setError(null); setStatus(null); setRegistryEntries(null); setRegistryStaged([]);
		try {
			const res = await ipc.registryFetch({ url: registryUrl.trim() });
			if (!res.ok) { setError(res.message ?? "registry index 拉取失败"); return; }
			if (res.data.entries.length === 0) { setError("registry index 中没有可用条目"); return; }
			setRegistryEntries(res.data.entries);
		} finally { setBusy(false); }
	}, [registryUrl]);
	const stageRegistry = React.useCallback(async () => {
		setBusy(true); setError(null); setStatus(null);
		try {
			const res = await ipc.registryStage({ url: registryUrl.trim() });
			if (!res.ok) { setError(res.message ?? "registry 下载失败"); return; }
			setRegistryStaged(res.data.results);
			const failed = res.data.results.filter((result) => result.error);
			setStatus(failed.length === 0 ? `已暂存 ${res.data.results.length} 个条目` : `已暂存 ${res.data.results.length - failed.length} 个条目，${failed.length} 个失败`);
		} finally { setBusy(false); }
	}, [registryUrl]);
	const installStagedEntry = React.useCallback(async (result: RegistryStagedResult, project: boolean) => {
		if (!result.path) return;
		await apply(() => ipc.installLocalResource({ source: result.path!, project }), `已安装 ${result.name}（SHA-256 ${result.sha256?.slice(0, 12)}…）`);
		void load();
	}, [apply, load]);
	const hay = query.trim().toLowerCase(); const match = (value: string) => !hay || value.toLowerCase().includes(hay);
	const extensions = (bundle?.extensions ?? []).filter((item) => match(`${item.name} ${item.path} ${item.source ?? ""}`));
	const skills = (bundle?.skills ?? []).filter((item) => match(`${item.name} ${item.description} ${item.filePath}`));
	const prompts = (bundle?.prompts ?? []).filter((item) => match(`${item.name} ${item.description} ${item.filePath}`));
	const packages = (bundle?.packages ?? []).filter((item) => match(`${item.source} ${item.installedPath ?? ""}`));
	const mcpServers = (mcpBundle?.items ?? []).filter((item) => match(`${item.name} ${item.command ?? ""} ${item.url ?? ""}`));
	return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="omega-dialog-wide"><DialogTitle>资源中心</DialogTitle><div className="omega-dialog-content-area omega-resource-content"><p className="omega-muted-text">管理当前会话加载的扩展、Skills 和 Prompt 模板。安装只接受本机路径，不会联网下载 npm/git 包。</p>{bundle?.projectTrusted === false ? <p className="omega-warning-text">当前项目未信任，项目级资源处于休眠状态。可在项目切换器中重新设置信任。</p> : null}<div className="omega-button-row"><Button size="sm" variant="solid" disabled={busy} onClick={() => void apply(() => ipc.installLocalResource({ project: false }), "已安装到用户范围")}>安装到用户</Button><Button size="sm" disabled={busy || bundle?.projectTrusted === false} onClick={() => void apply(() => ipc.installLocalResource({ project: true }), "已安装到项目范围")}>安装到项目</Button><Button size="sm" disabled={busy} onClick={() => { setRemoteStaged(null); setRemoteUrl(""); setRemoteFormOpen(true); }}>从 URL 安装</Button><Button size="sm" disabled={busy} onClick={() => { setRegistryEntries(null); setRegistryStaged([]); setRegistryFormOpen(true); }}>从 Registry 安装</Button><Button size="sm" disabled={busy} onClick={() => void apply(() => ipc.reloadResources(), "已重载当前会话资源")}>重载资源</Button>{busy ? <span className="omega-spinner" role="status" aria-label="处理中" /> : null}</div><div className="omega-setting-row"><div><strong>允许 /skill 调用</strong><span>模型可通过 slash 命令触发 Skills</span></div><Switch checked={bundle?.skillCommandsEnabled !== false} disabled={busy || !bundle} onCheckedChange={(enabled) => void apply(() => ipc.setSkillCommandsEnabled({ enabled }), "已更新 skill 命令")} /></div><TextField aria-label="搜索扩展、skill、prompt" placeholder="搜索扩展、skill、prompt…" value={query} onChange={(event) => setQuery(event.target.value)} />{error ? <p className="omega-error-text">{error}</p> : null}{status ? <p className="omega-status-text">{status}</p> : null}
		<h3 className="overline-label">扩展（{extensions.length}）</h3>{extensions.length === 0 ? <EmptyText>没有匹配的扩展。</EmptyText> : extensions.map((extension: ExtensionResource) => <ResourceRow key={extension.path} title={extension.name} subtitle={extension.path} chips={[scopeLabel(extension.scope), extension.origin === "package" ? "包" : "本地", extension.commands ? `${extension.commands} 命令` : "", extension.tools ? `${extension.tools} 工具` : ""].filter(Boolean)} enabled={extension.enabled !== false} dormant={extension.dormant} busy={busy} onToggle={(enabled) => void apply(() => ipc.setResourceEnabled({ kind: "extension", path: extension.path, enabled, project: extension.scope === "project", baseDir: extension.baseDir }), enabled ? "已启用扩展" : "已禁用扩展")} />)}
		<h3 className="overline-label">Skills（{skills.length}）</h3>{skills.length === 0 ? <EmptyText>没有匹配的 skills。</EmptyText> : skills.map((skill: SkillResource) => <ResourceRow key={skill.filePath} title={`/skill:${skill.name}`} subtitle={skill.description || skill.filePath} chips={[scopeLabel(skill.scope), skill.disableModelInvocation ? "模型不可见" : "模型可见", skill.contentHash ? `@${skill.contentHash.slice(0, 8)}` : "无 hash"]} enabled={skill.enabled !== false} dormant={skill.dormant} busy={busy} onToggle={(enabled) => void apply(() => ipc.setResourceEnabled({ kind: "skill", path: skill.filePath, enabled, project: skill.scope === "project", baseDir: skill.baseDir }), enabled ? "已启用 skill" : "已禁用 skill")} extra={<span className="omega-button-row"><Button size="sm" disabled={busy} onClick={() => void apply(() => ipc.setSkillModelInvocation({ filePath: skill.filePath, disable: !skill.disableModelInvocation }), skill.disableModelInvocation ? "已允许模型调用" : "已对模型隐藏")}>{skill.disableModelInvocation ? "允许模型调用" : "对模型隐藏"}</Button><Button size="sm" disabled={busy} onClick={() => void distillSkill(skill)}>Histos 蒸馏</Button></span>} />)}
		<h3 className="overline-label">Prompt 模板（{prompts.length}）</h3>{prompts.length === 0 ? <EmptyText>没有匹配的 prompt 模板。</EmptyText> : prompts.map((prompt: PromptResource) => <ResourceRow key={prompt.filePath} title={`/${prompt.name}`} subtitle={prompt.description || prompt.filePath} chips={[scopeLabel(prompt.scope), prompt.argumentHint ?? ""].filter(Boolean)} enabled={prompt.enabled !== false} dormant={prompt.dormant} busy={busy} onToggle={(enabled) => void apply(() => ipc.setResourceEnabled({ kind: "prompt", path: prompt.filePath, enabled, project: prompt.scope === "project", baseDir: prompt.baseDir }), enabled ? "已启用 prompt" : "已禁用 prompt")} />)}
		<h3 className="overline-label">已配置包（{packages.length}）</h3>{packages.length === 0 ? <EmptyText>还没有本地安装的包。</EmptyText> : packages.map((pkg: ConfiguredPackageInfo) => <div className="omega-resource-row omega-package-row" key={`${pkg.scope}:${pkg.source}`}><div><strong>{pkg.source}</strong><span className="omega-resource-subtitle">{scopeLabel(pkg.scope)} {pkg.installedPath}</span></div><Button size="sm" disabled={busy} onClick={() => void apply(() => ipc.removeLocalResource({ source: pkg.source, project: pkg.scope === "project" }), "已移除")}>移除</Button></div>)}
		<div className="omega-section-heading"><h3 className="overline-label">MCP 服务器</h3><Button size="sm" disabled={busy} onClick={() => { setMcpName(""); setMcpCommand(""); setMcpArgs(""); setMcpScopeProject(false); setMcpTransport("stdio"); setMcpUrl(""); setMcpAuthUrl(""); setMcpTokenUrl(""); setMcpClientId(""); setMcpFormOpen(true); }}>添加</Button></div>{mcpBundle && !mcpBundle.bridgeLoaded ? <p className="omega-warning-text">执行桥（ravel-mcp-bridge 扩展）未加载：定义可以保存，但工具不会出现在会话中，启用状态不会生效。</p> : null}{mcpServers.length === 0 ? <EmptyText>还没有 MCP 定义。</EmptyText> : mcpServers.map((server) => <ResourceRow key={`${server.scope}:${server.name}`} title={server.name} subtitle={server.transport === "http" ? (server.url ?? "") : [server.command, ...(server.args ?? [])].join(" ")} chips={[scopeLabel(server.scope), server.transport === "http" ? "HTTP" : "stdio", server.needsAuth ? "需要登录" : server.auth ? "OAuth 已登录" : ""].filter(Boolean)} enabled={server.enabled} busy={busy} onToggle={(enabled) => void applyMcp(() => ipc.mcpSetEnabled({ name: server.name, enabled, project: server.scope === "project" }), enabled ? "已启用 MCP 服务器" : "已禁用 MCP 服务器")} extra={<span className="omega-button-row">{server.needsAuth ? <Button size="sm" variant="solid" disabled={busy} onClick={() => void loginMcp(server)}>登录 OAuth</Button> : null}<Button size="sm" disabled={busy} onClick={() => setRemovingMcp(server)}>移除</Button></span>} />)}</div><DialogFooter><Button variant="solid" onClick={() => setOpen(false)}>完成</Button></DialogFooter></DialogContent>
		<Dialog open={remoteFormOpen} onOpenChange={setRemoteFormOpen}><DialogContent><DialogTitle>从 URL 安装资源</DialogTitle><div className="omega-dialog-content-area omega-form-stack"><p className="omega-muted-text">仅支持 https 单文件（SKILL.md / prompt / 扩展源码）。下载后先展示内容摘要与 SHA-256，确认后才会安装；安装仍走资源安装审批。</p><TextField label="https URL" value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://example.com/skills/my-skill.md" /><Button size="sm" disabled={busy || !remoteUrl.trim()} onClick={() => void stageRemote()}>下载并校验</Button>{remoteStaged ? <div className="omega-setting-row"><div><strong>{remoteStaged.filename}</strong><span className="mono-num">SHA-256 {remoteStaged.sha256.slice(0, 24)}… · {Math.ceil(remoteStaged.bytes / 1024)} KB</span></div></div> : null}</div><DialogFooter><Button onClick={() => setRemoteFormOpen(false)}>取消</Button><Button variant="solid" disabled={busy || !remoteStaged} onClick={() => void installRemote(false)}>安装到用户</Button><Button variant="solid" disabled={busy || !remoteStaged || bundle?.projectTrusted === false} onClick={() => void installRemote(true)}>安装到项目</Button></DialogFooter></DialogContent></Dialog>
		<Dialog open={mcpFormOpen} onOpenChange={setMcpFormOpen}><DialogContent><DialogTitle>添加 MCP 服务器</DialogTitle><div className="omega-dialog-content-area omega-form-stack"><p className="omega-muted-text">stdio 服务器只添加你信任的本机程序；HTTP 服务器走 streamable-HTTP，配置 OAuth 后可在列表中登录，令牌加密存入凭据库。</p><TextField label="名称" value={mcpName} onChange={(event) => setMcpName(event.target.value)} placeholder="github-context" /><TextField label="传输" select value={mcpTransport} onChange={(event) => setMcpTransport(event.target.value as "stdio" | "http")}><option value="stdio">stdio（本机命令）</option><option value="http">HTTP（streamable-HTTP）</option></TextField>{mcpTransport === "stdio" ? (<><TextField label="可执行命令" value={mcpCommand} onChange={(event) => setMcpCommand(event.target.value)} placeholder="npx -y @modelcontextprotocol/server-git" /><TextField label="参数（每行一个）" value={mcpArgs} onChange={(event) => setMcpArgs(event.target.value)} multiline minRows={2} /></>) : (<><TextField label="https URL" value={mcpUrl} onChange={(event) => setMcpUrl(event.target.value)} placeholder="https://mcp.example.com/mcp" /><TextField label="OAuth 授权端点（可选）" value={mcpAuthUrl} onChange={(event) => setMcpAuthUrl(event.target.value)} placeholder="https://auth.example.com/authorize" /><TextField label="OAuth 令牌端点（可选）" value={mcpTokenUrl} onChange={(event) => setMcpTokenUrl(event.target.value)} placeholder="https://auth.example.com/token" /><TextField label="OAuth Client ID（可选）" value={mcpClientId} onChange={(event) => setMcpClientId(event.target.value)} /></>)}<TextField label="范围" select value={mcpScopeProject ? "project" : "user"} onChange={(event) => setMcpScopeProject(event.target.value === "project")}><option value="user">用户（~/.ravel/mcp.json）</option><option value="project">项目（&lt;workspace&gt;/.ravel/mcp.json，需已信任）</option></TextField></div><DialogFooter><Button onClick={() => setMcpFormOpen(false)}>取消</Button><Button variant="solid" disabled={busy || !mcpName.trim() || (mcpTransport === "stdio" ? !mcpCommand.trim() : !mcpUrl.trim())} onClick={() => void applyMcp(() => ipc.mcpAdd({ name: mcpName, ...(mcpTransport === "stdio" ? { command: mcpCommand, args: mcpArgs.split("\n").map((line) => line.trim()).filter(Boolean) } : { url: mcpUrl.trim(), ...(mcpAuthUrl.trim() && mcpTokenUrl.trim() && mcpClientId.trim() ? { auth: { authorizationUrl: mcpAuthUrl.trim(), tokenUrl: mcpTokenUrl.trim(), clientId: mcpClientId.trim() } } : {}) }), project: mcpScopeProject }), "已保存 MCP 定义").then(() => setMcpFormOpen(false))}>保存</Button></DialogFooter></DialogContent></Dialog>
		<Dialog open={registryFormOpen} onOpenChange={setRegistryFormOpen}><DialogContent><DialogTitle>从 Registry 安装 Skill</DialogTitle><div className="omega-dialog-content-area omega-form-stack"><p className="omega-muted-text">registry 是一个 https 的 index.json，内含 skills 数组，每项带 name、description、url。拉取后并发下载所选条目到暂存区，逐个展示来源与 SHA-256，确认后才走正常安装审批；不执行任何安装脚本。</p><TextField label="registry index.json 的 https URL" value={registryUrl} onChange={(event) => setRegistryUrl(event.target.value)} placeholder="https://example.com/skills/index.json" /><Button size="sm" disabled={busy || !registryUrl.trim()} onClick={() => void fetchRegistry()}>拉取列表</Button>{registryEntries ? (<>{registryEntries.map((entry) => { const staged = registryStaged.find((result) => result.name === entry.name); return (<div className="omega-setting-row" key={entry.name}><div><strong>{entry.name}</strong><span>{entry.description || entry.url}</span></div>{staged?.sha256 ? <span className="mono-num">SHA-256 {staged.sha256.slice(0, 16)}…</span> : null}</div>); })}<Button size="sm" variant="solid" disabled={busy || registryEntries.length === 0} onClick={() => void stageRegistry()}>下载并暂存</Button>{registryStaged.length > 0 ? (<div className="omega-form-stack">{registryStaged.map((result) => result.error ? (<p key={result.name} className="omega-error-text">{result.name}：{result.error}</p>) : (<div className="omega-button-row" key={result.name}><Button size="sm" disabled={busy} onClick={() => void installStagedEntry(result, false)}>安装到用户</Button><Button size="sm" disabled={busy || bundle?.projectTrusted === false} onClick={() => void installStagedEntry(result, true)}>安装到项目</Button></div>))}</div>) : null}</>) : null}</div><DialogFooter><Button onClick={() => setRegistryFormOpen(false)}>关闭</Button></DialogFooter></DialogContent></Dialog>
		<Dialog open={removingMcp !== null} onOpenChange={(next) => { if (!next) setRemovingMcp(null); }}><DialogContent><DialogTitle>移除 {removingMcp?.name}？</DialogTitle><div className="omega-dialog-content-area"><p className="omega-muted-text">仅从 mcp.json 中删除这一个定义键，不改动文件中的其他内容。</p></div><DialogFooter><Button onClick={() => setRemovingMcp(null)}>取消</Button><Button variant="solid" disabled={busy} onClick={() => { const target = removingMcp; setRemovingMcp(null); if (target) void applyMcp(() => ipc.mcpRemove({ name: target.name, project: target.scope === "project" }), "已移除"); }}>移除</Button></DialogFooter></DialogContent></Dialog>
	</Dialog>;
}
