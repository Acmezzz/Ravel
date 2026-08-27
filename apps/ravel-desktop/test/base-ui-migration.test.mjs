import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ui = (name) => resolve(root, "src", "renderer", "ui", name);

async function source(name) {
  return readFile(ui(name), "utf8");
}

test("Base UI replaces Radix in every headless primitive wrapper", async () => {
  const files = ["Dialog.tsx", "Menu.tsx", "Popover.tsx", "Tooltip.tsx"];
  const sources = await Promise.all(files.map(source));
  for (const content of sources) {
    assert.match(content, /@base-ui\/react/);
    assert.doesNotMatch(content, /@radix-ui\//);
  }
});

test("primitive wrappers preserve the business-facing exports and adapters", async () => {
  const [dialog, menu, popover, tooltip] = await Promise.all([
    source("Dialog.tsx"),
    source("Menu.tsx"),
    source("Popover.tsx"),
    source("Tooltip.tsx"),
  ]);
  for (const name of ["Dialog", "DialogContent", "DialogTitle", "DialogDescription", "DialogClose"]) assert.match(dialog, new RegExp(`export (const|function) ${name}`));
  for (const name of ["Menu", "MenuAnchor", "MenuContent", "MenuItem"]) assert.match(menu, new RegExp(`export (const|function) ${name}`));
  assert.match(menu, /render=/);
  assert.match(popover, /anchor=\{anchor\}/);
  assert.match(popover, /initialFocus=\{false\}/);
  assert.match(tooltip, /asChild\?: boolean/);
  assert.match(tooltip, /Positioner/);
});

test("compact drawer accessibility contract remains intact", async () => {
  const workbench = await readFile(resolve(root, "src", "renderer", "components", "layout", "Workbench.tsx"), "utf8");
  assert.match(workbench, /setAttribute\("inert", ""\)/);
  assert.match(workbench, /event\.key === "Escape"/);
  assert.match(workbench, /event\.key !== "Tab"/);
  assert.match(workbench, /aria-modal="true"/);
});
