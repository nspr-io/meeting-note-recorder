#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const PREP_START = '<!-- PREP_NOTES -->';
const PREP_END = '<!-- /PREP_NOTES -->';
const TRANSCRIPT_DELIMITER = '\n---\n\n# Transcript';

async function collectMarkdownFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectMarkdownFiles(absolutePath);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(absolutePath);
    }
  }

  return files;
}

function needsRepair(markdown) {
  const startIndex = markdown.indexOf(PREP_START);
  if (startIndex === -1) {
    return false;
  }

  const hasClosing = markdown.indexOf(PREP_END, startIndex + PREP_START.length) !== -1;
  return !hasClosing;
}

function repairContent(markdown) {
  const startIndex = markdown.indexOf(PREP_START);
  if (startIndex === -1) {
    return markdown;
  }

  const insertionPoint = markdown.indexOf(TRANSCRIPT_DELIMITER, startIndex);
  const safeInsertionIndex = insertionPoint === -1 ? markdown.length : insertionPoint;

  const head = markdown.slice(0, safeInsertionIndex).replace(/\s*$/, '') + '\n';
  const tail = markdown.slice(safeInsertionIndex);

  return `${head}${PREP_END}${tail}`;
}

async function repairDirectory(rootDir) {
  const files = await collectMarkdownFiles(rootDir);
  const repaired = [];

  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    if (!needsRepair(content)) {
      continue;
    }

    const updated = repairContent(content);
    if (updated !== content) {
      await fs.writeFile(file, updated, 'utf-8');
      repaired.push(file);
    }
  }

  return repaired;
}

async function main() {
  const [, , targetDir] = process.argv;
  const storagePath = targetDir || process.env.MEETINGS_DIR;

  if (!storagePath) {
    console.error('Usage: repair-prep-markers.js <meetings-directory>');
    console.error('Or set MEETINGS_DIR to the root of your meeting archive.');
    process.exit(1);
  }

  try {
    const repaired = await repairDirectory(storagePath);
    if (!repaired.length) {
      console.log('No files required repair.');
      return;
    }

    console.log(`Repaired ${repaired.length} file(s):`);
    repaired.forEach((file) => console.log(` - ${file}`));
  } catch (error) {
    console.error('Failed to repair prep markers:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}

module.exports = {
  repairDirectory,
  repairContent,
  needsRepair,
};
