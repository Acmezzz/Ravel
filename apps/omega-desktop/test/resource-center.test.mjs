import test from "node:test";
import assert from "node:assert/strict";
import {
  assertLocalSource,
  buildResourceBundle,
  isNetworkSource,
  nextScopedPaths,
  setDisableModelInvocationFrontmatter,
} from "../electron/resource-center.js";

test("resource center refuses npm/git/http sources", () => {
  assert.equal(isNetworkSource("npm:@pi/skills"), true);
  assert.equal(isNetworkSource("git:github.com/org/repo"), true);
  assert.equal(isNetworkSource("https://example.com/pkg"), true);
  assert.equal(isNetworkSource("/home/user/skills/demo"), false);
  assert.throws(() => assertLocalSource("npm:pi-skill"), (error) => error.code === "network_forbidden");
  assert.equal(assertLocalSource("/tmp/local-skill"), "/tmp/local-skill");
});

test("installLocalResource IPC refuses renderer-supplied paths outside authorized roots", async () => {
  const { readFile } = await import("node:fs/promises");
  const main = await readFile(new URL("../electron/main.js", import.meta.url), "utf8");
  assert.match(main, /omega:installLocalResource/);
  assert.match(main, /pickedByDialog/);
  assert.match(main, /isUnderAuthorizedRoot\(source\)/);
});

test("resource enable patterns force-include and force-exclude a path", () => {
  const enabled = nextScopedPaths(["skills/*.md"], "D:/agent/.pi/skills/demo/SKILL.md", "D:/agent/.pi", true);
  assert.ok(enabled.some((entry) => entry.startsWith("+") && entry.endsWith("skills/demo/SKILL.md")));
  const disabled = nextScopedPaths(enabled, "D:/agent/.pi/skills/demo/SKILL.md", "D:/agent/.pi", false);
  assert.ok(disabled.some((entry) => entry.startsWith("-") && entry.endsWith("skills/demo/SKILL.md")));
  assert.equal(disabled.filter((entry) => entry.endsWith("skills/demo/SKILL.md")).length, 1);
});

test("skill frontmatter can toggle disable-model-invocation in place", () => {
  const added = setDisableModelInvocationFrontmatter("# Demo\nDo a thing.", true);
  assert.match(added, /^---\ndisable-model-invocation: true\n---/);
  const updated = setDisableModelInvocationFrontmatter("---\nname: demo\ndisable-model-invocation: true\n---\nbody", false);
  assert.match(updated, /disable-model-invocation: false/);
  assert.match(updated, /name: demo/);
});

test("resource bundle marks untrusted project items dormant", () => {
  const bundle = buildResourceBundle({
    projectTrusted: false,
    skillCommandsEnabled: true,
    packages: [{ source: "./local-skill", scope: "project", filtered: false, installedPath: "/repo/.pi/local-skill" }],
    resolved: {
      extensions: [],
      skills: [
        {
          path: "/repo/.pi/skills/secret/SKILL.md",
          enabled: true,
          metadata: { source: "local", scope: "project", origin: "top-level", baseDir: "/repo/.pi" },
        },
      ],
      prompts: [],
      themes: [],
    },
    skills: [{ name: "secret", description: "hidden", filePath: "/repo/.pi/skills/secret/SKILL.md", disableModelInvocation: false }],
  });
  assert.equal(bundle.skills[0].dormant, true);
  assert.equal(bundle.skills[0].enabled, false);
  assert.equal(bundle.projectTrusted, false);
  assert.equal(bundle.packages[0].scope, "project");
});
