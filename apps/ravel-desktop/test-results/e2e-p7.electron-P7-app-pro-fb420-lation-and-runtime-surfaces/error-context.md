# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e\p7.electron.spec.mjs >> P7 app protocol loading, Electron isolation, and runtime surfaces
- Location: e2e\p7.electron.spec.mjs:119:1

# Error details

```
Error: P7 Electron gate diagnostics
package: @ravel/desktop@0.1.0
mode: runtime
executable: D:\project\agent\Ravel\node_modules\electron\dist\electron.exe
profile: C:\Users\admin\AppData\Local\Temp\ravel-p7-electron-2aqRuu
console: []
pageErrors: []
url: app://bundle/index.html
error: Error: expect(locator).toBeVisible() failed

Locator: getByRole('tab', { name: /图谱|Graph/ })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('tab', { name: /图谱|Graph/ })

    at D:\project\agent\Ravel\apps\ravel-desktop\e2e\p7.electron.spec.mjs:138:63
```

# Test source

```ts
  38  | 
  39  | function executablePath() {
  40  |   return packagedExecutable ?? runtimeExecutable;
  41  | }
  42  | 
  43  | async function closeApplication(app) {
  44  |   if (!app) return;
  45  |   try {
  46  |     await Promise.race([app.close(), new Promise((resolveClose) => setTimeout(resolveClose, 5_000))]);
  47  |   } catch {
  48  |     /* The Electron channel may already be disposed after process exit. */
  49  |   }
  50  |   try {
  51  |     const child = app.process();
  52  |     if (child && child.exitCode === null) {
  53  |       // Windows: SIGKILL on the main process orphans Electron utility
  54  |       // processes (agent/histos/PTY) that keep inherited handles open, which
  55  |       // stalls the Playwright worker teardown. Reap the whole tree.
  56  |       if (process.platform === "win32") {
  57  |         spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  58  |       } else {
  59  |         child.kill("SIGKILL");
  60  |       }
  61  |       const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  62  |       await Promise.race([exited, new Promise((resolveExit) => setTimeout(resolveExit, 5_000))]);
  63  |     }
  64  |   } catch {
  65  |     /* Process already gone. */
  66  |   }
  67  | }
  68  | 
  69  | function diagnostics(error, app, profileDir) {
  70  |   const target = app?.windows()?.[0];
  71  |   return [
  72  |     `P7 Electron gate diagnostics`,
  73  |     `package: ${packageJson.name}@${packageJson.version}`,
  74  |     `mode: ${packagedExecutable ? "packaged" : "runtime"}`,
  75  |     `executable: ${executablePath()}`,
  76  |     `profile: ${profileDir ?? "unknown"}`,
  77  |     `console: ${JSON.stringify(consoleMessages)}`,
  78  |     `pageErrors: ${JSON.stringify(pageErrors)}`,
  79  |     `url: ${target?.url?.() ?? "no page"}`,
  80  |     `error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  81  |   ].join("\n");
  82  | }
  83  | 
  84  | async function launchP7() {
  85  |   const profileDir = mkdtempSync(join(tmpdir(), "ravel-p7-electron-"));
  86  |   const workspace = mkdtempSync(join(tmpdir(), "ravel-p7-workspace-"));
  87  |   const seed = await seedSession({ workspace, home: profileDir });
  88  |   const app = await electron.launch({
  89  |     executablePath: executablePath(),
  90  |     args: [...executableArgs(), `--user-data-dir=${profileDir}`, "--disable-gpu", "--no-sandbox"],
  91  |     cwd: packagedExecutable ? runtimeEntry : desktopRoot,
  92  |     env: {
  93  |       ...process.env,
  94  |       HOME: profileDir,
  95  |       USERPROFILE: profileDir,
  96  |       RAVEL_WORKSPACE: workspace,
  97  |       OMEGA_WORKSPACE: workspace,
  98  |       RAVEL_EXTENSIONS_ROOT: join(repoRoot, ".pi", "extensions"),
  99  |       OMEGA_EXTENSIONS_ROOT: join(repoRoot, ".pi", "extensions"),
  100 |       ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  101 |       ...(packagedExecutable ? {} : { RAVEL_P7_RUNTIME: "1" }),
  102 |     },
  103 |   });
  104 |   const page = await app.firstWindow();
  105 |   page.on("pageerror", (error) => { pageErrors.push(String(error)); });
  106 |   page.on("console", (message) => { consoleMessages.push(`${message.type()}: ${message.text()}`); });
  107 |   await page.waitForLoadState("domcontentloaded");
  108 |   return { app, page, profileDir, workspace, seed, consoleMessages, pageErrors };
  109 | }
  110 | 
  111 | test.beforeEach(() => { pageErrors = []; consoleMessages = []; });
  112 | 
  113 | test.afterEach(async ({}, testInfo) => {
  114 |   if (testInfo.status !== testInfo.expectedStatus) {
  115 |     testInfo.annotations.push({ type: "diagnostics", description: `mode=${packagedExecutable ? "packaged" : "runtime"}; executable=${executablePath()}` });
  116 |   }
  117 | });
  118 | 
  119 | test("P7 app protocol loading, Electron isolation, and runtime surfaces", async () => {
  120 |   let harness;
  121 |   try {
  122 |     harness = await launchP7();
  123 |     const { app, page, profileDir, seed } = harness;
  124 |     pageErrors = harness.pageErrors;
  125 |     consoleMessages = harness.consoleMessages;
  126 |     await expect.poll(() => page.url()).toBe("app://bundle/index.html");
  127 |     await expect(page.locator("#root")).toBeVisible();
  128 |     await expect(page.locator("#omega-composer-input")).toBeVisible();
  129 |     await expect(page.locator(".omega-status-glyph")).toBeVisible();
  130 |     expect(await page.evaluate(() => ({
  131 |       protocol: window.location.protocol,
  132 |       hasNode: typeof window.node,
  133 |       hasRequire: typeof window.require,
  134 |       hasProcess: typeof window.process,
  135 |       hasOmega: typeof window.omega,
  136 |       contextIsolation: typeof window.omega === "object",
  137 |     }))).toMatchObject({ protocol: "app:", hasNode: "undefined", hasRequire: "undefined", hasProcess: "undefined", hasOmega: "object", contextIsolation: true });
> 138 |     await expect(page.getByRole("tab", { name: /图谱|Graph/ })).toBeVisible();
      |                                                               ^ Error: P7 Electron gate diagnostics
  139 |     await expect(page.getByRole("tab", { name: /终端|Terminal/ })).toBeVisible();
  140 |     await expect(page.getByRole("tab", { name: /遥测|Telemetry/ })).toBeVisible();
  141 |     await page.getByRole("tab", { name: /图谱|Graph/ }).click();
  142 |     await expect(page.locator(".omega-graph-panel")).toBeVisible();
  143 |     await expect(page.getByText("Graph", { exact: true }).first()).toBeVisible();
  144 |     expect(seed.sessionId).toBe("p7-seeded-session");
  145 |     await closeApplication(app);
  146 |     expect(pageErrors, diagnostics(new Error("renderer page error"), app, profileDir)).toEqual([]);
  147 |     expect(consoleMessages.filter((message) => /error/i.test(message)), diagnostics(new Error("renderer console error"), app, profileDir)).toEqual([]);
  148 |   } catch (error) {
  149 |     throw new Error(diagnostics(error, harness?.app, harness?.profileDir), { cause: error });
  150 |   } finally {
  151 |     await closeApplication(harness?.app);
  152 |     removeTempDirectory(harness?.profileDir);
  153 |     removeTempDirectory(harness?.workspace);
  154 |   }
  155 | });
  156 | 
  157 | // PTY and ContextSet/approval are exercised only when the normal boot surfaces are stable.
  158 | test("P7 best-effort PTY and ContextSet/approval surfaces", async () => {
  159 |   let harness;
  160 |   try {
  161 |     harness = await launchP7();
  162 |     const { page, app, profileDir } = harness;
  163 |     await expect(page.locator("#omega-composer-input")).toBeVisible();
  164 |     await page.getByRole("tab", { name: /图谱|Graph/ }).click();
  165 |     const canvas = page.locator(".omega-graph-canvas");
  166 |     await expect(canvas).toBeVisible();
  167 |     const nodes = canvas.locator(".react-flow__node");
  168 |     if (await nodes.count()) {
  169 |       await nodes.first().click();
  170 |       const freeze = page.getByRole("button", { name: /冻结上下文|Freeze context/ });
  171 |       if (await freeze.isEnabled()) {
  172 |         await freeze.click();
  173 |         await expect(page.getByRole("status").filter({ hasText: /ContextSet/ })).toBeVisible();
  174 |       }
  175 |     }
  176 |     await page.getByRole("tab", { name: /终端|Terminal/ }).click();
  177 |     await expect(page.getByRole("region", { name: /终端|Terminal/ })).toBeVisible();
  178 |     await closeApplication(app);
  179 |   } catch (error) {
  180 |     test.info().annotations.push({ type: "best-effort", description: `PTY/ContextSet/approval skipped: ${error instanceof Error ? error.message : String(error)}` });
  181 |     await closeApplication(harness?.app);
  182 |   } finally {
  183 |     removeTempDirectory(harness?.profileDir);
  184 |     removeTempDirectory(harness?.workspace);
  185 |   }
  186 | });
  187 | 
```