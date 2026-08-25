import * as React from "react";
import Box from "@mui/material/Box";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useAppStore } from "../../store/useAppStore";
import type {
  WorkflowCatalog,
  WorkflowRegistry,
  WorkflowTracker,
  WorkflowMemoryCoverage,
  WorkflowStats,
  WorkflowHealth,
} from "../../types/dto";

const SUBTABS = ["catalog", "registry", "tracker", "coverage", "stats", "health"] as const;
/** Chinese-first tab labels — internal keys never surface as UI copy. */
const SUBTAB_LABEL: Record<(typeof SUBTABS)[number], string> = {
  catalog: "功能目录",
  registry: "注册表",
  tracker: "运行快照",
  coverage: "记忆覆盖",
  stats: "统计",
  health: "健康检查",
};
const MAX_FEATURES = 80;
const MAX_REGISTRY_ENTRIES = 120;
const MAX_ISSUES = 40;
const MAX_ESCAPES = 40;
type SubTab = (typeof SUBTABS)[number];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper
      sx={{
        p: 1.5,
        mb: 1.5,
        background: "var(--omega-bg-panel)",
        border: "1px solid var(--omega-border)",
        boxShadow: "var(--omega-inset-highlight)",
      }}
    >
      <Typography sx={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--omega-text-muted)", mb: 1, letterSpacing: "0.04em" }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function CatalogView({ data }: { data: WorkflowCatalog }) {
  const [expanded, setExpanded] = React.useState(false);
  if (data.features.length === 0) return <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.75rem" }}>无目录数据。</Typography>;
  const visible = expanded ? data.features : data.features.slice(0, MAX_FEATURES);
  return (
    <Stack spacing={1}>
      {visible.map((f) => (
        <Box key={f.id}>
          <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--omega-text)" }}>{f.label}</Typography>
          <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)" }}>{f.description}</Typography>
          {f.levelSemantics ? (
            <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)", mt: 0.5 }}>{f.levelSemantics}</Typography>
          ) : null}
          <Box sx={{ mt: 0.5, display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            <Chip size="small" label={`${f.entryIds.length} 实体`} sx={{ height: 20, fontSize: "0.65625rem" }} />
            {f.aliases.slice(0, 4).map((a) => (
              <Chip key={a} size="small" label={a} variant="outlined" sx={{ height: 20, fontSize: "0.65625rem", color: "var(--omega-text-muted)" }} />
            ))}
          </Box>
        </Box>
      ))}
      {data.features.length > MAX_FEATURES ? <Button size="small" onClick={() => setExpanded((value) => !value)} sx={{ alignSelf: "flex-start", textTransform: "none" }}>{expanded ? "收起目录" : `展开其余 ${data.features.length - MAX_FEATURES} 项`}</Button> : null}
    </Stack>
  );
}

function RegistryView({ data }: { data: WorkflowRegistry }) {
  const [expanded, setExpanded] = React.useState(false);
  if (data.entries.length === 0) return <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.75rem" }}>无注册表数据。</Typography>;
  const visible = expanded ? data.entries : data.entries.slice(0, MAX_REGISTRY_ENTRIES);
  return (
    <Stack spacing={1}>
      {visible.map((e) => (
        <Box key={e.id} sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Chip size="small" label={`L${e.level}`} sx={{ height: 20, fontSize: "0.65625rem" }} />
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text)", fontWeight: 600 }}>{e.intent || e.id}</Typography>
          <Chip
            size="small"
            label={e.status}
            color={e.status === "active" ? "success" : e.status === "deprecated" ? "error" : "warning"}
            sx={{ height: 20, fontSize: "0.65625rem" }}
          />
          <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-muted)" }}>
            ev {e.evidence} · use {e.usage} · esc {e.escapes}
          </Typography>
        </Box>
      ))}
      {data.entries.length > MAX_REGISTRY_ENTRIES ? <Button size="small" onClick={() => setExpanded((value) => !value)} sx={{ alignSelf: "flex-start", textTransform: "none" }}>{expanded ? "收起注册表" : `展开其余 ${data.entries.length - MAX_REGISTRY_ENTRIES} 项`}</Button> : null}
    </Stack>
  );
}

/** Precision step rail: one node per step, hairline connectors, live pulse on the current step. */
function StepRail({ total, current, escaped }: { total: number; current: number; escaped: boolean }) {
  const MAX_NODES = 12;
  const count = Math.max(total, current + 1);
  const overflow = count > MAX_NODES;
  const nodes = Math.min(count, MAX_NODES);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0, mt: 1, mb: 0.5 }}>
      {Array.from({ length: nodes }, (_, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={i}>
            {i > 0 ? (
              <Box
                sx={{
                  flex: "1 1 auto",
                  minWidth: 8,
                  height: 1,
                  background: done || active ? "var(--omega-accent-line)" : "var(--omega-border-strong)",
                  transition: "background 200ms var(--omega-ease-out)",
                }}
              />
            ) : null}
            <Box
              className={active && !escaped ? "pulse-dot" : undefined}
              title={`步骤 ${i + 1}`}
              sx={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                flex: "0 0 auto",
                border: `1px solid ${active ? "var(--omega-accent)" : done ? "var(--omega-success)" : "var(--omega-border-strong)"}`,
                background: active ? "var(--omega-accent)" : done ? "var(--omega-success-soft)" : "transparent",
                boxShadow: active ? "0 0 7px var(--omega-accent)" : "none",
                transition: "all 200ms var(--omega-ease-out)",
              }}
            />
          </React.Fragment>
        );
      })}
      {overflow ? (
        <Typography className="mono-num" sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)", ml: 0.75, flex: "0 0 auto" }}>
          +{count - MAX_NODES}
        </Typography>
      ) : null}
    </Box>
  );
}

function TrackerView({ data }: { data: WorkflowTracker }) {
  return (
    <Stack spacing={0.5}>
      <Typography sx={{ fontSize: "0.8125rem", color: "var(--omega-text)" }}>工作流：{data.workflowId}</Typography>
      {data.intent ? <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)" }}>意图：{data.intent}</Typography> : null}
      <Typography className="mono-num" sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)" }}>
        步骤 {data.currentIndex}/{data.stepCount}
        {data.escaped ? " · 已逃逸" : ""}
        {data.alternativeId ? ` · 备选 ${data.alternativeId}` : ""}
      </Typography>
      <StepRail total={data.stepCount} current={data.currentIndex} escaped={data.escaped} />
      <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>更新：{data.updatedAt || "未更新"}</Typography>
    </Stack>
  );
}

function CoverageView({ data }: { data: WorkflowMemoryCoverage }) {
  return (
    <Stack spacing={0.5}>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)" }}>已蒸馏至 seq：{data.distilledUpTo}</Typography>
      <Typography sx={{ fontSize: "0.75rem", color: data.stale ? "var(--omega-warning)" : "var(--omega-success)" }}>
        状态：{data.stale ? "过期（需重新蒸馏）" : "覆盖完整"}
      </Typography>
      <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>片段数：{data.segments.length}</Typography>
    </Stack>
  );
}

function StatsView({ data }: { data: WorkflowStats }) {
  return (
    <Stack spacing={0.5}>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)" }}>项目：{data.projectKey}</Typography>
      <Typography sx={{ fontSize: "0.75rem", color: "var(--omega-text-muted)" }}>
        任务 {data.tasks} · 回合 {data.turns} · 待蒸馏 {data.pendingDistill}
      </Typography>
      {data.escapes.length > 0 ? (
        <Box sx={{ mt: 0.5 }}>
          <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-warning)" }}>逃逸记录：</Typography>
          {data.escapes.slice(0, MAX_ESCAPES).map((e, i) => (
            <Typography key={i} sx={{ fontSize: "0.65625rem", color: "var(--omega-text-muted)" }}>
              · {e.workflowId} @ step {e.stepIndex}：{e.reason}
            </Typography>
          ))}
        </Box>
      ) : (
        <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>无逃逸记录。</Typography>
      )}
    </Stack>
  );
}

function HealthView({ data }: { data: WorkflowHealth }) {
  return (
    <Stack spacing={0.5}>
      <Chip
        size="small"
        label={`健康：${data.status}`}
        color={data.status === "ok" ? "success" : data.status === "warn" ? "warning" : "error"}
      />
      <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-muted)" }}>
        任务 {data.summary.tasks} · 日志回合 {data.summary.journalTurns} · 待恢复 {data.summary.pendingRestore}
      </Typography>
      {data.issues.length > 0 ? (
        <Box sx={{ mt: 0.5 }}>
          {data.issues.slice(0, MAX_ISSUES).map((issue, i) => (
            <Typography key={i} sx={{ fontSize: "0.65625rem", color: issue.severity === "error" ? "var(--omega-danger)" : "var(--omega-warning)" }}>
              · [{issue.code}] {issue.detail}
            </Typography>
          ))}
        </Box>
      ) : (
        <Typography sx={{ fontSize: "0.65625rem", color: "var(--omega-text-dim)" }}>无问题。</Typography>
      )}
    </Stack>
  );
}

export function WorkflowPanel(): React.ReactElement {
  const extension = useAppStore((s) => s.extensionState);
  const [sub, setSub] = React.useState<SubTab>("catalog");

  const catalog = extension.workflow_catalog;
  const registry = extension.workflow_registry;
  const tracker = extension.workflow_tracker;
  const coverage = extension.workflow_memory_coverage;
  const stats = extension.workflow_stats;
  const health = extension.workflow_health;

  return (
    <Box>
      <Tabs
        value={sub}
        onChange={(_e, v) => setSub(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          mb: 1,
          minHeight: 36,
          "& .MuiTab-root": { minHeight: 36, fontSize: "0.75rem", px: 0.9, minWidth: 0 },
        }}
      >
        {SUBTABS.map((t) => (
          <Tab key={t} value={t} label={SUBTAB_LABEL[t]} />
        ))}
      </Tabs>
      {sub === "catalog" ? <Section title="功能目录 Catalog">{catalog ? <CatalogView data={catalog} /> : <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.75rem" }}>无数据</Typography>}</Section> : null}
      {sub === "registry" ? <Section title="注册表 Registry">{registry ? <RegistryView data={registry} /> : <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.75rem" }}>无数据</Typography>}</Section> : null}
      {sub === "tracker" ? <Section title="运行快照 Tracker">{tracker ? <TrackerView data={tracker} /> : <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.75rem" }}>当前任务无 tracker</Typography>}</Section> : null}
      {sub === "coverage" ? <Section title="记忆覆盖 Coverage">{coverage ? <CoverageView data={coverage} /> : <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.75rem" }}>当前任务无记忆日志</Typography>}</Section> : null}
      {sub === "stats" ? <Section title="项目统计 Stats">{stats ? <StatsView data={stats} /> : <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.75rem" }}>无数据</Typography>}</Section> : null}
      {sub === "health" ? <Section title="健康检查 Health">{health ? <HealthView data={health} /> : <Typography sx={{ color: "var(--omega-text-dim)", fontSize: "0.75rem" }}>无数据</Typography>}</Section> : null}
    </Box>
  );
}
