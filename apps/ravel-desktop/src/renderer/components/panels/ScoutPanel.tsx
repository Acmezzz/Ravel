import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import { useAppStore } from "../../store/useAppStore";
import type { ScoutStatus, ScoutRounds, ScoutProposals } from "../../types/dto";

const MAX_ROUNDS = 40;
const MAX_PROPOSALS = 80;
const MAX_STEPS = 40;

function StatusCard({ data }: { data: ScoutStatus }) {
  return (
    <Paper sx={{ p: 1.5, mb: 1.5, background: "var(--omega-bg-panel)", border: "1px solid var(--omega-border)" }}>
      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mb: 0.5 }}>
        <Chip size="small" label={data.enabled ? "启用" : "禁用"} color={data.enabled ? "success" : "default"} />
        <Chip size="small" label={`策略 ${data.policy}`} />
        <Chip
          size="small"
          label={data.mode === "active" ? "活动中" : "空闲"}
          sx={data.mode === "active" ? { background: "var(--omega-accent-soft)", color: "var(--omega-accent-strong)" } : undefined}
        />
        <Chip size="small" label={`每任务上限 ${data.maxRoundsPerTask} 轮`} variant="outlined" />
      </Box>
      <Box sx={{ mt: 0.5 }}>
        {data.currentRoundId ? (
          <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-muted)" }}>当前轮：{data.currentRoundId}</Typography>
        ) : (
          <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>暂无进行中的探索轮。</Typography>
        )}
      </Box>
    </Paper>
  );
}

function RoundCard({ round }: { round: NonNullable<ScoutRounds["rounds"][number]> }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <Paper sx={{ p: 1.5, mb: 1, background: "var(--omega-bg-panel)", border: "1px solid var(--omega-border)" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--omega-text)" }}>{round.roundId}</Typography>
        <Chip size="small" label={round.trigger} />
        <Chip size="small" label={`verified: ${round.verifiedOutcome}`} color={round.verifiedOutcome === "succeeded" ? "success" : "default"} />
      </Box>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)", mt: 0.5 }}>目标：{round.taskBrief.objective || "未提供"}</Typography>
      <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>
        {round.runs.length} 个 Scout · {round.runs.reduce((acc, r) => acc + r.proposalCount, 0)} 个 proposal · 模型 {round.model}
      </Typography>
      {round.selection ? (
        <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-accent)", mt: 0.5 }}>
          已采纳 {round.selection.selectedProposalIds.length} 个提案
        </Typography>
      ) : null}
      <Button size="small" onClick={() => setExpanded((value) => !value)} sx={{ mt: 0.5, textTransform: "none" }}>{expanded ? "收起运行详情" : "查看运行详情"}</Button>
      {expanded ? <Box sx={{ mt: 0.75 }}>{round.runs.map((run) => <Typography key={run.scoutId} sx={{ fontSize: "0.65625rem", color: "var(--omega-text-muted)" }}>· {run.scoutId}：{run.proposalCount} 个提案</Typography>)}</Box> : null}
    </Paper>
  );
}

function ProposalCard({ proposal }: { proposal: NonNullable<ScoutProposals["proposals"][number]> }) {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <Paper sx={{ p: 1.25, mb: 1, background: "var(--omega-bg-elevated)", border: "1px solid var(--omega-border)" }}>
      <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--omega-text)" }}>{proposal.idea}</Typography>
      {proposal.steps.length > 0 ? (
        <Box component="ul" sx={{ m: 0, pl: 2, color: "var(--omega-text-muted)", fontSize: "0.75rem" }}>
          {proposal.steps.slice(0, expanded ? proposal.steps.length : MAX_STEPS).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
          {proposal.steps.length > MAX_STEPS ? <li><Button size="small" onClick={() => setExpanded((value) => !value)} sx={{ textTransform: "none", p: 0, minWidth: 0 }}>{expanded ? "收起步骤" : `展开其余 ${proposal.steps.length - MAX_STEPS} 个步骤`}</Button></li> : null}
        </Box>
      ) : null}
      {proposal.assumptions.length > 0 ? (
        <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>假设：{proposal.assumptions.join("；")}</Typography>
      ) : null}
      {proposal.expectedEvidence.length > 0 ? (
        <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>预期证据：{proposal.expectedEvidence.join("；")}</Typography>
      ) : null}
      {proposal.closureStatus ? (
        <Chip size="small" label={`闭合：${proposal.closureStatus}`} sx={{ mt: 0.5, height: 20, fontSize: "0.65625rem" }} />
      ) : null}
    </Paper>
  );
}

export function ScoutPanel(): React.ReactElement {
  const extension = useAppStore((s) => s.extensionState);
  const status = extension.scout_status;
  const rounds = extension.scout_rounds;
  const proposals = extension.scout_proposals;

  if (!status) {
    return <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.75rem" }}>暂无 Scout 状态（可能未加载扩展）。</Typography>;
  }

  return (
    <Box>
      <StatusCard data={status} />
      <Divider sx={{ my: 1, borderColor: "var(--omega-border)" }} />
      <Typography sx={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--omega-text-muted)", mb: 0.5 }}>探索轮 Rounds</Typography>
      {rounds && rounds.rounds.length > 0 ? (
        <>
          {rounds.rounds.slice(0, MAX_ROUNDS).map((r) => <RoundCard key={r.roundId} round={r} />)}
          {rounds.rounds.length > MAX_ROUNDS ? <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-warning)" }}>已折叠 {rounds.rounds.length - MAX_ROUNDS} 个探索轮。</Typography> : null}
        </>
      ) : (
        <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.75rem" }}>无探索轮记录。</Typography>
      )}
      <Divider sx={{ my: 1, borderColor: "var(--omega-border)" }} />
      <Typography sx={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--omega-text-muted)", mb: 0.5 }}>提案 Proposals</Typography>
      {proposals && proposals.proposals.length > 0 ? (
        <>
          {proposals.proposals.slice(0, MAX_PROPOSALS).map((p) => <ProposalCard key={p.id} proposal={p} />)}
          {proposals.proposals.length > MAX_PROPOSALS ? <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-warning)" }}>已折叠 {proposals.proposals.length - MAX_PROPOSALS} 个提案。</Typography> : null}
        </>
      ) : (
        <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.75rem" }}>当前轮无提案。</Typography>
      )}
    </Box>
  );
}
