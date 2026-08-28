import * as React from "react";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";
import { ipc } from "../../ipc/client";
import { useT } from "../../lib/i18n";
import type { PermissionRuleRow } from "../../types/dto";

/**
 * Persistent per-tool permission rules (next-cycle B3). User rules apply
 * everywhere; project rules are trust-gated and only visible in a trusted
 * workspace. Rules can only narrow: the safety floor still escalates
 * destructive patterns to ask, and a deny rule wins in every profile.
 */
const ACTION_KEY = {
	allow: "settings.rulesAction.allow",
	ask: "settings.rulesAction.ask",
	deny: "settings.rulesAction.deny",
} as const;

export function PermissionRulesSection(): React.ReactElement {
	const t = useT();
	const [items, setItems] = React.useState<PermissionRuleRow[]>([]);
	const [permission, setPermission] = React.useState("");
	const [pattern, setPattern] = React.useState("");
	const [action, setAction] = React.useState<"allow" | "ask" | "deny">("ask");
	const [project, setProject] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const reload = React.useCallback(async () => {
		try {
			const res = await ipc.permissionRulesList();
			if (res.ok) setItems(res.data.items);
			else setError(res.message ?? t("common.unknownError"));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		}
	}, [t]);

	React.useEffect(() => {
		void reload();
	}, [reload]);

	const add = React.useCallback(async () => {
		setError(null);
		try {
			const res = await ipc.permissionRulesAdd({ permission, pattern: pattern.trim() || "*", action, project });
			if (res.ok) {
				setItems(res.data.items);
				setPermission("");
				setPattern("");
			} else {
				setError(res.message ?? t("common.unknownError"));
			}
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		}
	}, [permission, pattern, action, project, t]);

	const remove = React.useCallback(async (row: PermissionRuleRow) => {
		setError(null);
		try {
			const res = await ipc.permissionRulesRemove({ id: row.id, scope: row.scope });
			if (res.ok) setItems(res.data.items);
			else setError(res.message ?? t("common.unknownError"));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		}
	}, [t]);

	return (
		<section className="omega-form-stack">
			<h3 className="overline-label">{t("settings.section.rules")}</h3>
			<p className="omega-muted-text">{t("settings.rulesHelper")}</p>
			{error ? <p role="alert" className="omega-error-text">{error}</p> : null}
			{items.length === 0 ? <p className="omega-muted-text">{t("settings.rulesEmpty")}</p> : (
				<ul className="omega-rules-list">
					{items.map((row) => (
						<li key={row.id} className="omega-rules-row">
							<span className="omega-chip omega-chip-queue">{row.scope === "project" ? t("settings.rulesScopeProject") : t("settings.rulesScopeUser")}</span>
							<code className="omega-rules-tool">{row.permission}</code>
							<code className="omega-rules-pattern">{row.pattern}</code>
							<span className="omega-rules-action">{t(ACTION_KEY[row.action])}</span>
							<Button size="sm" onClick={() => void remove(row)}>{t("settings.rulesRemove")}</Button>
						</li>
					))}
				</ul>
			)}
			<div className="omega-settings-grid">
				<TextField label={t("settings.rulesTool")} hint={t("settings.rulesToolHint")} value={permission} onChange={(event) => setPermission(event.target.value)} />
				<TextField label={t("settings.rulesPattern")} hint={t("settings.rulesPatternHint")} value={pattern} onChange={(event) => setPattern(event.target.value)} />
				<TextField select label={t("settings.rulesActionLabel")} value={action} onChange={(event) => setAction(event.target.value as "allow" | "ask" | "deny")}>
					<option value="allow">{t("settings.rulesAction.allow")}</option>
					<option value="ask">{t("settings.rulesAction.ask")}</option>
					<option value="deny">{t("settings.rulesAction.deny")}</option>
				</TextField>
				<TextField select label={t("settings.rulesScope")} value={project ? "project" : "user"} onChange={(event) => setProject(event.target.value === "project")}>
					<option value="user">{t("settings.rulesScopeUser")}</option>
					<option value="project">{t("settings.rulesScopeProject")}</option>
				</TextField>
			</div>
			<div>
				<Button size="sm" variant="solid" onClick={() => void add()} disabled={!permission.trim()}>{t("settings.rulesAdd")}</Button>
			</div>
		</section>
	);
}
