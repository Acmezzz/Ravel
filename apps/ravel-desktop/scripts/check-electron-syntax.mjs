import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const electronDir = join(root, "..", "electron");
const files = (await readdir(electronDir)).filter((file) => file.endsWith(".js") || file.endsWith(".mjs")).sort();

for (const file of files) {
  const path = join(electronDir, file);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", path], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${file} syntax check failed${signal ? ` (${signal})` : ""}`));
    });
  });
}
