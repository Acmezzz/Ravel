import * as React from "react";
import { ClipboardList } from "lucide-react";
import { Button } from "../../ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "../../ui/Dialog";
import { useAppStore } from "../../store/useAppStore";
import { ipc } from "../../ipc/client";
import { useT } from "../../lib/i18n";

/**
 * Plan-mode human gate (next-cycle B1): shows the plan file the agent wrote,
 * and only an explicit approval exits plan mode — the main process then
 * switches the mode profile and injects the durable approval message.
 */
export function PlanReview(): React.ReactElement | null {
	const t = useT();
	const desktopSettings = useAppStore((s) => s.desktopSettings);
	const setDesktopSettings = useAppStore((s) => s.setDesktopSettings);
	const [open, setOpen] = React.useState(false);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [plan, setPlan] = React.useState<{ path: string | null; exists: boolean; content: string } | null>(null);

	const load = React.useCallback(async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await ipc.planReview();
			if (res.ok) setPlan(res.data);
			else setError(res.message ?? t("common.unknownError"));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	}, [t]);

	const openDialog = React.useCallback(() => {
		setOpen(true);
		setPlan(null);
		void load();
	}, [load]);

	const approve = React.useCallback(async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await ipc.approvePlan();
			if (res.ok) {
				if (desktopSettings) setDesktopSettings({ ...desktopSettings, modeProfile: "default" });
				setOpen(false);
			} else {
				setError(res.message ?? t("common.unknownError"));
			}
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	}, [desktopSettings, setDesktopSettings, t]);

	if (desktopSettings?.modeProfile !== "plan") return null;

	return (
		<div className="omega-plan-review">
			<span className="omega-chip omega-chip-queue">{t("planReview.modeChip")}</span>
			<Button size="sm" variant="solid" onClick={openDialog} disabled={busy}>
				<ClipboardList className="omega-icon-14" aria-hidden="true" /> {t("planReview.open")}
			</Button>

			<Dialog open={open} onOpenChange={(next) => { if (!next) setOpen(false); }}>
				<DialogContent className="omega-dialog-narrow">
					<DialogTitle>{t("planReview.title")}</DialogTitle>
					<div className="omega-dialog-content-area omega-form-stack">
						{error ? <p role="alert" className="omega-error-text">{error}</p> : null}
						{plan === null ? (
							<p className="omega-muted-text">{t("planReview.loading")}</p>
						) : plan.exists ? (
							<>
								<p className="omega-muted-text">{plan.path}</p>
								<pre className="omega-plan-review-content">{plan.content}</pre>
							</>
						) : (
							<p className="omega-muted-text">{t("planReview.empty")}</p>
						)}
					</div>
					<DialogFooter>
						<Button onClick={() => void load()} disabled={busy}>{t("planReview.refresh")}</Button>
						<Button onClick={() => setOpen(false)}>{t("planReview.keepPlanning")}</Button>
						<Button variant="solid" onClick={() => void approve()} disabled={busy || !plan?.exists}>
							{t("planReview.approve")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
