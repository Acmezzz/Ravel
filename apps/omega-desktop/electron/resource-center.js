/**
 * Plugins / Skills center helpers. Pure transforms so the desktop Resource
 * Center can list, locally install, enable/disable and reload Pi resources
 * without npm/git network installs.
 */
import { basename, relative, sep } from "node:path";

export const NETWORK_PREFIXES = Object.freeze(["npm:", "git:", "github:", "http:", "https:", "ssh:"]);
export const RESOURCE_KINDS = Object.freeze(["extension", "skill", "prompt"]);
export const RESOURCE_ARRAY_KEYS = Object.freeze({
  extension: "extensions",
  skill: "skills",
  prompt: "prompts",
});

export function toPosix(value) {
  return String(value ?? "").split(sep).join("/");
}

export function pathKey(value) {
  return toPosix(value).replace(/\/+$/, "").toLowerCase();
}

export function isNetworkSource(source) {
  const trimmed = String(source ?? "").trim().toLowerCase();
  if (!trimmed) return false;
  return NETWORK_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function assertLocalSource(source) {
  if (typeof source !== "string" || !source.trim()) {
    const error = new Error("source is required");
    error.code = "invalid_args";
    throw error;
  }
  const trimmed = source.trim();
  if (isNetworkSource(trimmed)) {
    const error = new Error("资源中心当前禁止联网安装。请选择本地目录或文件。");
    error.code = "network_forbidden";
    throw error;
  }
  return trimmed;
}

export function resourcePattern(filePath, baseDir) {
  const rel = baseDir ? relative(baseDir, filePath) : basename(filePath);
  const posix = toPosix(rel);
  return posix && posix !== "." ? posix : basename(filePath);
}

function stripOverride(entry) {
  const value = String(entry ?? "");
  return value.startsWith("!") || value.startsWith("+") || value.startsWith("-") ? value.slice(1) : value;
}

export function setPathEnabled(paths, pattern, enabled) {
  const current = Array.isArray(paths) ? paths.filter((entry) => typeof entry === "string") : [];
  const next = current.filter((entry) => stripOverride(entry) !== pattern);
  next.push(`${enabled ? "+" : "-"}${pattern}`);
  return next;
}

export function setDisableModelInvocationFrontmatter(content, disabled) {
  const normalized = String(content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const flag = disabled ? "true" : "false";
  if (normalized.startsWith("---")) {
    const end = normalized.indexOf("\n---", 3);
    if (end !== -1) {
      let yaml = normalized.slice(4, end);
      const body = normalized.slice(end + 4);
      if (/^disable-model-invocation:\s*/m.test(yaml)) {
        yaml = yaml.replace(/^disable-model-invocation:\s*.*$/m, `disable-model-invocation: ${flag}`);
      } else {
        yaml = `${yaml.trimEnd()}\ndisable-model-invocation: ${flag}\n`;
      }
      const suffix = body.startsWith("\n") ? body : `\n${body}`;
      return `---\n${yaml.trim()}\n---${suffix}`;
    }
  }
  return `---\ndisable-model-invocation: ${flag}\n---\n${normalized}`;
}

function displayName(path, loadedName) {
  if (typeof loadedName === "string" && loadedName.trim()) return loadedName.trim();
  const base = basename(path || "");
  return base.replace(/\.(ts|js|md|json)$/i, "") || path || "未命名";
}

function mapResolved(kind, resources, loadedByPath, projectTrusted) {
  return (Array.isArray(resources) ? resources : []).map((resource) => {
    const path = resource?.path ?? "";
    const loaded = loadedByPath.get(pathKey(path));
    const scope = resource?.metadata?.scope === "project" ? "project" : resource?.metadata?.scope === "temporary" ? "temporary" : "user";
    const origin = resource?.metadata?.origin === "package" ? "package" : "top-level";
    const dormant = projectTrusted === false && scope === "project";
    return {
      kind,
      name: displayName(path, loaded?.name),
      path,
      description: typeof loaded?.description === "string" ? loaded.description : "",
      enabled: resource?.enabled !== false && !dormant,
      scope,
      origin,
      source: resource?.metadata?.source ?? "",
      baseDir: resource?.metadata?.baseDir ?? "",
      commands: Number(loaded?.commands) || 0,
      tools: Number(loaded?.tools) || 0,
      argumentHint: loaded?.argumentHint,
      disableModelInvocation: loaded?.disableModelInvocation === true,
      dormant,
    };
  });
}

export function buildResourceBundle({
  resolved,
  extensions = [],
  skills = [],
  prompts = [],
  packages = [],
  projectTrusted = true,
  skillCommandsEnabled = true,
} = {}) {
  const extensionByPath = new Map();
  for (const extension of extensions) {
    const path = extension?.sourceInfo?.path ?? extension?.path;
    if (!path) continue;
    extensionByPath.set(pathKey(path), {
      name: basename(path),
      path,
      commands: extension.commands?.size ?? extension.commands ?? 0,
      tools: extension.tools?.size ?? extension.tools ?? 0,
    });
  }
  const skillByPath = new Map();
  for (const skill of skills) {
    if (!skill?.filePath) continue;
    skillByPath.set(pathKey(skill.filePath), {
      name: skill.name,
      description: skill.description ?? "",
      disableModelInvocation: skill.disableModelInvocation === true,
    });
  }
  const promptByPath = new Map();
  for (const prompt of prompts) {
    if (!prompt?.filePath) continue;
    promptByPath.set(pathKey(prompt.filePath), {
      name: prompt.name,
      description: prompt.description ?? "",
      argumentHint: prompt.argumentHint,
    });
  }

  const extensionItems = mapResolved("extension", resolved?.extensions, extensionByPath, projectTrusted);
  const skillItems = mapResolved("skill", resolved?.skills, skillByPath, projectTrusted);
  const promptItems = mapResolved("prompt", resolved?.prompts, promptByPath, projectTrusted);

  return {
    extensions: extensionItems.map((item) => ({
      name: item.name,
      path: item.path,
      commands: item.commands,
      tools: item.tools,
      enabled: item.enabled,
      scope: item.scope,
      origin: item.origin,
      source: item.source,
      baseDir: item.baseDir,
      dormant: item.dormant,
    })),
    skills: skillItems.map((item) => ({
      name: item.name,
      description: item.description,
      filePath: item.path,
      enabled: item.enabled,
      scope: item.scope,
      origin: item.origin,
      source: item.source,
      baseDir: item.baseDir,
      disableModelInvocation: item.disableModelInvocation,
      dormant: item.dormant,
    })),
    prompts: promptItems.map((item) => ({
      name: item.name,
      description: item.description,
      argumentHint: item.argumentHint,
      filePath: item.path,
      enabled: item.enabled,
      scope: item.scope,
      origin: item.origin,
      source: item.source,
      baseDir: item.baseDir,
      dormant: item.dormant,
    })),
    packages: (Array.isArray(packages) ? packages : []).map((pkg) => ({
      source: pkg.source,
      scope: pkg.scope === "project" ? "project" : "user",
      filtered: pkg.filtered === true,
      installedPath: pkg.installedPath ?? "",
    })),
    projectTrusted: projectTrusted !== false,
    skillCommandsEnabled: skillCommandsEnabled !== false,
  };
}

export function nextScopedPaths(current, filePath, baseDir, enabled) {
  return setPathEnabled(current, resourcePattern(filePath, baseDir), enabled);
}
