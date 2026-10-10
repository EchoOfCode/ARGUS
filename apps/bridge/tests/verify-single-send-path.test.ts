/**
 * Architectural Invariant Test (ADR 0003): Single Outbound Send Path Verification.
 * Asserts that Baileys `sock.sendMessage()` is ONLY called inside `src/policy/dispatcher.ts`.
 * Any other invocation across the codebase will fail this test and break CI.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, "../src");

function findTsFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

test("Architecture Invariant: Baileys sendMessage() is only called in policy/dispatcher.ts", () => {
  const allFiles = findTsFiles(srcDir);
  const allowedFile = path.normalize(path.join(srcDir, "policy", "dispatcher.ts"));
  const violations: Array<{ file: string; line: number; text: string }> = [];

  const sendMessagePattern = /\b(sock|\.sock|socket)\.sendMessage\s*\(/;

  for (const file of allFiles) {
    const normalizedFile = path.normalize(file);
    if (normalizedFile === allowedFile) {
      continue; // The dispatcher is the sole authorized choke point
    }

    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");

    lines.forEach((lineText, idx) => {
      // Ignore comment lines
      const trimmed = lineText.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
        return;
      }

      if (sendMessagePattern.test(lineText)) {
        violations.push({
          file: path.relative(srcDir, file),
          line: idx + 1,
          text: lineText.trim(),
        });
      }
    });
  }

  assert.equal(
    violations.length,
    0,
    `Violations detected! The following files call sock.sendMessage() outside policy/dispatcher.ts:\n` +
      violations.map((v) => `  - ${v.file}:${v.line} -> "${v.text}"`).join("\n")
  );
});
