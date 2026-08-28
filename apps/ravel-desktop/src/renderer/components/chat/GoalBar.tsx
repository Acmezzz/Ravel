import * as React from "react";
import { Target } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useT } from "../../lib/i18n";

/**
 * Goal-mode status bar (next-cycle B2): shows the continuation loop state.
 * The loop stops on abort, error, or round/elapsed budget exhaustion — never
 * on a model completion claim.
 */
export function GoalBar(): React.ReactElement | null {
	const t = useT();
	const mode = useAppStore((s) => s.agent?.mode);
	const goal = useAppStore((s) => s.agent?.goal);

	if (mode !== "goal") return null;

	return (
		<div className="omega-plan-review">
			<span className="omega-chip omega-chip-steer">
				<Target className="omega-icon-14" aria-hidden="true" /> {t("goalBar.modeChip")}
			</span>
			<span className="omega-composer-queue-text">
				{goal ? t("goalBar.active", { n: goal.rounds }) : t("goalBar.idle")}
			</span>
		</div>
	);
}
