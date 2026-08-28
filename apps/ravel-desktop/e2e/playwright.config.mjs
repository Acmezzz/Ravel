import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "p7.electron.spec.mjs",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { outputFolder: "test-results/p7-report", open: "never" }]] : "list",
  outputDir: "test-results/p7-artifacts",
});
