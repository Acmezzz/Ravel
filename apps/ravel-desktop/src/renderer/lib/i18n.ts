/**
 * Minimal typed i18n foundation.
 *
 * The desktop settings already persist `language` ("zh-CN" | "en-US"); this
 * module gives components a `useT()` hook that resolves UI copy against the
 * active language. zh-CN is the source of truth: every key MUST exist there,
 * while en-US falls back to it when a translation has not been written yet.
 *
 * Rollout convention: migrate copy per component/slice (all strings of one
 * surface at once) so a half-translated screen can never ship.
 */
import * as React from "react";
import { useAppStore } from "../store/useAppStore";

export type Language = "zh-CN" | "en-US";
export const DEFAULT_LANGUAGE: Language = "zh-CN";

const messages = {
  "zh-CN": {
    "status.initFailed": "初始化失败",
    "status.retryable": "可重试",
    "status.workerFailed": "Worker 失败",
    "status.closing": "正在停止",
    "status.flushing": "保存会话",
    "status.exiting": "正在退出",
    "status.compacting": "压缩中",
    "status.thinking": "思考中",
    "status.running": "运行中",
    "status.error": "错误",
    "status.connecting": "连接中",
    "status.ready": "就绪",
    "thinking.off": "思考 off",
    "thinking.minimal": "思考 min",
    "thinking.low": "思考 low",
    "thinking.medium": "思考 mid",
    "thinking.high": "思考 high",
    "thinking.xhigh": "思考 xhigh",
    "thinking.max": "思考 max",
    "theme.light": "浅色",
    "theme.dark": "深色",
    "theme.system": "跟随系统",
    "menu.theme": "主题",
    "menu.thinkingGroup": "思考档位",
  },
  "en-US": {
    "status.initFailed": "Initialization failed",
    "status.retryable": "Retry available",
    "status.workerFailed": "Worker failed",
    "status.closing": "Stopping",
    "status.flushing": "Saving session",
    "status.exiting": "Exiting",
    "status.compacting": "Compacting",
    "status.thinking": "Thinking",
    "status.running": "Running",
    "status.error": "Error",
    "status.connecting": "Connecting",
    "status.ready": "Ready",
    "thinking.off": "Thinking off",
    "thinking.minimal": "Thinking min",
    "thinking.low": "Thinking low",
    "thinking.medium": "Thinking mid",
    "thinking.high": "Thinking high",
    "thinking.xhigh": "Thinking xhigh",
    "thinking.max": "Thinking max",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "theme.system": "System",
    "menu.theme": "Theme",
    "menu.thinkingGroup": "Thinking level",
  },
} as const;

export type MessageKey = keyof typeof messages[typeof DEFAULT_LANGUAGE];

export function translate(language: Language, key: MessageKey): string {
  return messages[language]?.[key] ?? messages[DEFAULT_LANGUAGE][key];
}

/** Resolve the active UI language from persisted desktop settings. */
export function useLanguage(): Language {
  return useAppStore((s) => s.desktopSettings?.language ?? DEFAULT_LANGUAGE);
}

/** Reactive translator bound to the active language. */
export function useT(): (key: MessageKey) => string {
  const language = useLanguage();
  return React.useCallback((key: MessageKey) => translate(language, key), [language]);
}
