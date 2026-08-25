import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const MIGRATION_VERSION = 1;
const MIGRATED_FILES = ["workspaces.json", "desktop-settings.json", "credentials.bin.json"];

function copyTree(source, destination) {
  const sourceStat = statSync(source);
  if (sourceStat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) copyTree(join(source, entry), join(destination, entry));
    return;
  }
  if (!existsSync(destination)) copyFileSync(source, destination);
}

function writeMarker(targetRoot) {
  writeFileSync(
    join(targetRoot, ".migration.json"),
    `${JSON.stringify({ source: "omega", version: MIGRATION_VERSION, completedAt: new Date().toISOString() }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

export function migrateOmegaUserData(userDataPath) {
  const sourceRoot = join(userDataPath, "omega");
  const targetRoot = join(userDataPath, "ravel");
  if (existsSync(targetRoot) || !existsSync(sourceRoot)) return { migrated: false, sourceRoot, targetRoot };

  const stagingRoot = join(userDataPath, `.ravel-migration-${process.pid}-${Date.now()}`);
  mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  try {
    for (const fileName of MIGRATED_FILES) {
      const source = join(sourceRoot, fileName);
      if (existsSync(source)) copyTree(source, join(stagingRoot, basename(fileName)));
    }
    const eventCache = join(sourceRoot, "event-cache");
    if (existsSync(eventCache)) copyTree(eventCache, join(stagingRoot, "event-cache"));
    writeMarker(stagingRoot);
    if (existsSync(targetRoot)) return { migrated: false, sourceRoot, targetRoot };
    copyTree(stagingRoot, targetRoot);
    return { migrated: true, sourceRoot, targetRoot };
  } finally {
    if (existsSync(targetRoot)) rmSync(stagingRoot, { recursive: true, force: true });
  }
}

export { MIGRATION_VERSION };
