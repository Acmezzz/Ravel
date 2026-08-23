import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeDesktopSettings } from "../electron/desktop-settings.js";

test("language preference is bounded to supported local UI options", () => {
  assert.equal(sanitizeDesktopSettings({ language: "zh-CN" }).language, "zh-CN");
  assert.equal(sanitizeDesktopSettings({ language: "fr-FR" }).language, "zh-CN");
});
