#!/usr/bin/env node
/**
 * scripts/build-source-manifest.mjs
 *
 * Source-to-Build Binding Manifest Generator for P2.6 Tahap 2.
 *
 * Captures source hashes of tracked files before and after Next.js build,
 * binds them to the generated .next/BUILD_ID, and generates an immutable
 * build manifest for verification by test runners.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const TRACKED_FILE_SCOPE = "p26_inbox_and_auth";
export const TRACKED_FILE_DESCRIPTION =
  "Subkelompok berkas UI Inbox, layout shell, routing, auth configuration, format helper, dan service server/kontrak P2.6";

export const TRACKED_SOURCE_FILES = [
  "components/inbox/inbox-conversation-panel.tsx",
  "components/inbox/inbox-dashboard.tsx",
  "components/inbox/inbox-conversation-list.tsx",
  "components/inbox/inbox-filter-bar.tsx",
  "components/inbox/inbox-pagination.tsx",
  "components/inbox/inbox-status-badge.tsx",
  "components/inbox/inbox-status-banner.tsx",
  "components/inbox/inbox-types.ts",
  "components/layout/dashboard-shell.tsx",
  "app/dashboard/page.tsx",
  "app/dashboard/complaints/page.tsx",
  "lib/supabase/auth-config.ts",
  "lib/supabase/server.ts",
  "lib/application/inbox-contracts.ts",
  "lib/application/inbox-service.server.ts",
  "lib/application/inbox-service.ts",
  "lib/application/origin-validator.ts",
  "lib/utils/format-date.ts",
];

export function computeSourceHashes(fileList = TRACKED_SOURCE_FILES, baseDir = process.cwd()) {
  const hashes = {};
  for (const relPath of fileList) {
    const fullPath = path.resolve(baseDir, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Tracked source file does not exist: ${relPath}`);
    }
    const content = fs.readFileSync(fullPath);
    hashes[relPath] = crypto.createHash("sha256").update(content).digest("hex");
  }
  return hashes;
}

export function generateBuildManifest({
  buildId,
  preHashes,
  postHashes,
  trackedFiles = TRACKED_SOURCE_FILES,
}) {
  if (!buildId || typeof buildId !== "string" || !buildId.trim()) {
    throw new Error("Invalid buildId: must be a non-empty string");
  }

  const cleanBuildId = buildId.trim();

  // Validate preHashes and postHashes match identically
  const preKeys = Object.keys(preHashes || {}).sort();
  const postKeys = Object.keys(postHashes || {}).sort();

  if (preKeys.length !== postKeys.length || preKeys.join(",") !== postKeys.join(",")) {
    return {
      status: "MUTATED_DURING_BUILD",
      error: "Tracked file list changed during build process",
      buildId: cleanBuildId,
      createdAt: new Date().toISOString(),
      scope: TRACKED_FILE_SCOPE,
      scopeDescription: TRACKED_FILE_DESCRIPTION,
      trackedFiles,
    };
  }

  const mismatchedFiles = [];
  for (const key of preKeys) {
    if (preHashes[key] !== postHashes[key]) {
      mismatchedFiles.push({ file: key, preHash: preHashes[key], postHash: postHashes[key] });
    }
  }

  if (mismatchedFiles.length > 0) {
    return {
      status: "MUTATED_DURING_BUILD",
      error: `Tracked source mutated during build in ${mismatchedFiles.length} file(s)`,
      mismatchedFiles,
      buildId: cleanBuildId,
      createdAt: new Date().toISOString(),
      scope: TRACKED_FILE_SCOPE,
      scopeDescription: TRACKED_FILE_DESCRIPTION,
      trackedFiles,
    };
  }

  return {
    status: "VALID",
    buildId: cleanBuildId,
    createdAt: new Date().toISOString(),
    scope: TRACKED_FILE_SCOPE,
    scopeDescription: TRACKED_FILE_DESCRIPTION,
    trackedFiles,
    sourceHashes: postHashes,
  };
}

export function saveBuildManifest(
  manifest,
  targetPaths = [
    path.resolve(".next/build-source-manifest.json"),
    path.resolve("docs/evidence/P2_6/build-source-manifest.json"),
  ]
) {
  const jsonContent = JSON.stringify(manifest, null, 2);
  for (const targetPath of targetPaths) {
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, jsonContent);
    } catch (e) {
      console.warn(`Failed to save manifest to ${targetPath}:`, e.message);
    }
  }
}

export function cleanBuildManifest(
  targetPaths = [
    path.resolve(".next/build-source-manifest.json"),
    path.resolve("docs/evidence/P2_6/build-source-manifest.json"),
  ]
) {
  for (const targetPath of targetPaths) {
    try {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    } catch {}
  }
}

export function readBuildManifest(
  manifestPath = path.resolve(".next/build-source-manifest.json")
) {
  try {
    if (fs.existsSync(manifestPath)) {
      const content = fs.readFileSync(manifestPath, "utf8");
      return JSON.parse(content);
    }
  } catch {}
  return null;
}

export function validateBuildMetadata({
  manifest,
  currentBuildId,
  launchHashes,
  finalizeHashes,
  mode = "live_browser_normal",
}) {
  // 1. Modes that do not start Next.js or run the built application
  if (mode === "guard_rejection" || mode === "setup_failure") {
    return {
      isValid: true,
      isApplicable: false,
      status: "NOT_APPLICABLE",
      reason: "Mode tidak menjalankan build atau server aplikasi Next.js",
      checks: {
        manifestExists: Boolean(manifest),
        buildIdMatch: "NOT_APPLICABLE",
        launchSourceMatch: "NOT_APPLICABLE",
        runtimeSourceMatch: "NOT_APPLICABLE",
      },
    };
  }

  // 2. Application-running modes require valid build manifest
  if (!manifest || manifest.status !== "VALID") {
    return {
      isValid: false,
      isApplicable: true,
      status: "MISSING_OR_INVALID_MANIFEST",
      reason: "Manifest build tidak ditemukan atau tidak berstatus VALID",
      checks: {
        manifestExists: false,
        buildIdMatch: false,
        launchSourceMatch: false,
        runtimeSourceMatch: false,
      },
    };
  }

  // 3. Current BUILD_ID must match manifest
  if (!currentBuildId || manifest.buildId !== currentBuildId) {
    return {
      isValid: false,
      isApplicable: true,
      status: "BUILD_ID_MISMATCH",
      reason: `BUILD_ID saat ini (${currentBuildId || "null"}) tidak cocok dengan manifest build (${manifest.buildId})`,
      checks: {
        manifestExists: true,
        buildIdMatch: false,
        launchSourceMatch: false,
        runtimeSourceMatch: false,
      },
    };
  }

  // 4. Source hashes at launch must match manifest sourceHashes
  if (!launchHashes) {
    return {
      isValid: false,
      isApplicable: true,
      status: "LAUNCH_HASHES_MISSING",
      reason: "Hash source pada saat runner launch tidak tersedia",
      checks: {
        manifestExists: true,
        buildIdMatch: true,
        launchSourceMatch: false,
        runtimeSourceMatch: false,
      },
    };
  }

  const mismatchedLaunchFiles = [];
  const tracked = manifest.trackedFiles || Object.keys(manifest.sourceHashes || {});
  for (const file of tracked) {
    if (manifest.sourceHashes[file] !== launchHashes[file]) {
      mismatchedLaunchFiles.push({
        file,
        buildHash: manifest.sourceHashes[file],
        launchHash: launchHashes[file],
      });
    }
  }

  if (mismatchedLaunchFiles.length > 0) {
    return {
      isValid: false,
      isApplicable: true,
      status: "SOURCE_CHANGED_BEFORE_LAUNCH",
      reason: `Source berubah setelah build sebelum runner dimulai pada ${mismatchedLaunchFiles.length} file: ${mismatchedLaunchFiles.map((m) => m.file).join(", ")}`,
      checks: {
        manifestExists: true,
        buildIdMatch: true,
        launchSourceMatch: false,
        runtimeSourceMatch: false,
      },
      mismatchedLaunchFiles,
    };
  }

  // 5. Source hashes at finalize must match launchHashes if provided
  if (finalizeHashes) {
    const mismatchedRuntimeFiles = [];
    for (const file of tracked) {
      if (launchHashes[file] !== finalizeHashes[file]) {
        mismatchedRuntimeFiles.push({
          file,
          launchHash: launchHashes[file],
          finalizeHash: finalizeHashes[file],
        });
      }
    }

    if (mismatchedRuntimeFiles.length > 0) {
      return {
        isValid: false,
        isApplicable: true,
        status: "SOURCE_CHANGED_DURING_RUN",
        reason: `Source berubah selama runner berjalan pada ${mismatchedRuntimeFiles.length} file: ${mismatchedRuntimeFiles.map((m) => m.file).join(", ")}`,
        checks: {
          manifestExists: true,
          buildIdMatch: true,
          launchSourceMatch: true,
          runtimeSourceMatch: false,
        },
        mismatchedRuntimeFiles,
      };
    }
  }

  return {
    isValid: true,
    isApplicable: true,
    status: "SYNCHRONIZED",
    reason: "BUILD_ID dan seluruh source hashes cocok dengan manifest build",
    checks: {
      manifestExists: true,
      buildIdMatch: true,
      launchSourceMatch: true,
      runtimeSourceMatch: true,
    },
  };
}

export function executeBuildWithManifest() {
  console.log("=== BUILD WITH SOURCE MANIFEST BINDING ===");
  console.log(`[Build] Menghitung hash awal ${TRACKED_SOURCE_FILES.length} file source terpilih...`);
  const preHashes = computeSourceHashes();

  // Invalidate any old manifest before build begins
  cleanBuildManifest();

  console.log("[Build] Menjalankan Next.js build...");
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "cmd.exe" : "npx";
  const args = isWindows ? ["/d", "/s", "/c", "npx next build"] : ["next", "build"];

  const buildResult = spawnSync(cmd, args, { stdio: "inherit" });

  if (buildResult.status !== 0) {
    cleanBuildManifest();
    console.error(`[Build] Kompilasi Next.js gagal dengan exit code ${buildResult.status}. Manifest tidak dibuat.`);
    return { success: false, exitCode: buildResult.status || 1 };
  }

  console.log("[Build] Kompilasi berhasil. Menghitung hash akhir file source terpilih...");
  const postHashes = computeSourceHashes();

  // Read .next/BUILD_ID
  const buildIdPath = path.resolve(".next/BUILD_ID");
  if (!fs.existsSync(buildIdPath)) {
    cleanBuildManifest();
    console.error("[Build] .next/BUILD_ID tidak ditemukan setelah build selesai. Manifest tidak dibuat.");
    return { success: false, exitCode: 1 };
  }
  const buildId = fs.readFileSync(buildIdPath, "utf8").trim();

  const manifest = generateBuildManifest({
    buildId,
    preHashes,
    postHashes,
    trackedFiles: TRACKED_SOURCE_FILES,
  });

  if (manifest.status !== "VALID") {
    cleanBuildManifest();
    console.error(`[Build] GAGAL: ${manifest.error}. Manifest tidak dibuat.`);
    return { success: false, exitCode: 1, manifest };
  }

  saveBuildManifest(manifest);
  console.log(`[Build] Manifest pengikatan build-source berhasil disimpan.`);
  console.log(`        BUILD_ID: ${buildId}`);
  console.log(`        Tracked Files: ${TRACKED_SOURCE_FILES.length} berkas`);
  console.log(`        Status: VALID`);
  return { success: true, manifest, buildId, exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const res = executeBuildWithManifest();
  process.exit(res.success ? 0 : (res.exitCode || 1));
}
