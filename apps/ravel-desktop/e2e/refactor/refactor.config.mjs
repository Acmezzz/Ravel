/**
 * 任务十 refactor e2e 只读覆盖 config。
 *
 * 背景：apps/ravel-desktop/e2e/playwright.config.mjs 的 `testMatch` 精确匹配
 * "p7.electron.spec.mjs"，因此无法用原 config 直接收集 e2e/refactor/ 下的新 spec。
 * 本文件按原 config 的语义（90s timeout / 15s expect / 1 worker / 相同 reporter)只重写
 * testMatch 与产物输出目录，其余行为保持不变，供命令行单独指定使用：
 *
 *   npx playwright test --config=refactor/refactor.config.mjs
 *
 * 不修改、不影响原 apps/ravel-desktop/e2e/playwright.config.mjs 的行为。
 */
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

// electron 主进程工作目录（apps/ravel-desktop/e2e）——testDir 以此计算 refactor/* 相对路径。
const e2eDir = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  testDir: e2eDir,
  testMatch: ["refactor/*.electron.spec.mjs"],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter:
    process.env.CI
      ? [["line"], ["html", { outputFolder: "test-results/refactor-report", open: "never" }]]
      : "list",
  outputDir: "test-results/refactor-artifacts",
});