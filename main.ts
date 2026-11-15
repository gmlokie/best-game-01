// NEON RUSH — best-game-01 entrypoint (Node 22, standard library only).
//
// What this program does: it takes the game in this repository (the static
// files under game/ plus the four screenshots under screenshots/) and hands
// them in as the entry's output. It copies both folders into the output
// directory the grader provides, then writes /output/dossier.json with the
// vendored make.fun library, which summarises the game for the judge.
//
// How to run it outside the grader, where MAKEFUN_OUTPUT_DIR stands in for
// the grader's /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The output is deterministic: the same repository always produces the same
// bytes, because the copy is a plain recursive copy in filesystem order and
// the dossier is built purely from the copied files (no timestamps, no
// random data, no network).

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The repository root is the folder this file lives in.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The grader sets /output; local runs use MAKEFUN_OUTPUT_DIR instead.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Caps from the competition's gate: the dossier may hold at most 160 KiB of
// source text, at most 4 screenshots of at most 256 KiB each, and game/ may
// hold at most 993 entries totalling at most 48 MiB, with no path longer
// than 1000 bytes. buildDossier enforces them and fails loudly otherwise.
const DOSSIER_OPTIONS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function copyEntryFolder(name) {
  const source = join(repoRoot, name);
  const target = join(outputDir, name);
  if (!existsSync(source)) {
    throw new Error(`NEON RUSH: expected folder ${name}/ beside main.ts, but it is missing`);
  }
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
  return readdirSync(target).length;
}

mkdirSync(outputDir, { recursive: true });
const gameEntries = copyEntryFolder('game');
const shotEntries = copyEntryFolder('screenshots');

const dossier = buildDossier(outputDir, DOSSIER_OPTIONS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);

console.log(
  `NEON RUSH: handed in ${gameEntries} game entries and ${shotEntries} screenshots to ${outputDir}`,
);
