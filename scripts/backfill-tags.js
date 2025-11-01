#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const matter = require('gray-matter');
const YAML = require('yaml');
const ts = require('typescript');
const ElectronStoreModule = require('electron-store');
const ElectronStore = ElectronStoreModule.default || ElectronStoreModule;
const Anthropic = require('@anthropic-ai/sdk');

let YamlAstType;
try {
  ({ Type: YamlAstType } = require('yaml/util'));
} catch (error) {
  YamlAstType = null;
}

const APP_DATA_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'meeting-note-recorder'
);
const MEETINGS_CACHE_PATH = path.join(APP_DATA_DIR, 'meetings-cache.json');

async function loadMeetingsCache() {
  const raw = await fs.readFile(MEETINGS_CACHE_PATH, 'utf-8');
  return JSON.parse(raw);
}

function resolveConfig() {
  const store = new ElectronStore({
    encryptionKey: 'meeting-recorder-secret-key',
    cwd: APP_DATA_DIR
  });

  const storagePath = store.get('storagePath') || path.join(os.homedir(), 'Documents', 'MeetingRecordings');
  const anthropicApiKey = (store.get('anthropicApiKey') || process.env.ANTHROPIC_API_KEY || '').trim();

  if (!anthropicApiKey) {
    throw new Error('Anthropic API key is required to backfill tags. Add it in settings before running this script.');
  }

  return { storagePath, anthropicApiKey };
}

async function loadStandardTags() {
  const sourcePath = path.join(__dirname, '..', 'src', 'shared', 'constants', 'meetingTags.ts');
  const source = await fs.readFile(sourcePath, 'utf-8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019
    }
  });

  const exports = {};
  const module = { exports };
  // eslint-disable-next-line no-new-func
  const evaluator = new Function('exports', 'require', 'module', '__filename', '__dirname', transpiled.outputText);
  evaluator(exports, require, module, sourcePath, path.dirname(sourcePath));

  const tags = module.exports?.STANDARD_MEETING_TAGS;
  if (!Array.isArray(tags)) {
    throw new Error('Failed to load STANDARD_MEETING_TAGS from shared constants.');
  }

  return tags.map((tag) => String(tag));
}

function normalizeAttendees(attendees) {
  if (!Array.isArray(attendees)) {
    return [];
  }

  return attendees
    .map((attendee) => {
      if (typeof attendee === 'string') {
        return attendee;
      }
      if (attendee && typeof attendee === 'object') {
        if (typeof attendee.email === 'string') {
          return attendee.email;
        }
        if (typeof attendee.name === 'string') {
          return attendee.name;
        }
      }
      return '';
    })
    .filter(Boolean);
}

function deriveFallbackTags(meeting) {
  const tags = new Set();
  const title = (meeting.title || '').toLowerCase();

  if (title.includes('sales') || title.includes('demo') || title.includes('discovery')) {
    tags.add('sales');
  }

  if (
    title.includes('kickoff') ||
    title.includes('standup') ||
    title.includes('stand-up') ||
    title.includes('retro') ||
    title.includes('retrospective') ||
    title.includes('internal')
  ) {
    tags.add('internal');
  }

  if (title.includes('client') || title.includes('customer') || title.includes('account')) {
    tags.add('existing-client');
  }

  const attendeeEmails = normalizeAttendees(meeting.attendees).filter((email) => email.includes('@'));

  if (attendeeEmails.some((email) => email.toLowerCase().includes('sales'))) {
    tags.add('sales');
  }

  if (attendeeEmails.some((email) => email.toLowerCase().includes('support'))) {
    tags.add('support');
  }

  if (tags.size === 0) {
    tags.add('internal');
  }

  return Array.from(tags);
}

function formatFrontmatter(data) {
  const cloned = { ...data };

  if (Array.isArray(cloned.tags)) {
    cloned.tags = cloned.tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0);
    if (cloned.tags.length === 0) {
      delete cloned.tags;
    }
  }

  Object.keys(cloned).forEach((key) => {
    if (cloned[key] === undefined) {
      delete cloned[key];
    }
  });

  if (YamlAstType) {
    YAML.scalarOptions.str.defaultType = YamlAstType.QUOTE_DOUBLE;
  }

  const yamlContent = YAML.stringify(cloned);
  return `---\n${yamlContent}---`;
}

async function updateMeetingFile(filePath, tags) {
  const original = await fs.readFile(filePath, 'utf-8');
  const parsed = matter(original, { preserveWhitespace: true });

  parsed.data.tags = tags.map((tag) => tag.trim()).filter(Boolean);

  const frontmatter = formatFrontmatter(parsed.data);
  const body = parsed.content.startsWith('\n') ? parsed.content : `\n${parsed.content}`;
  const nextContent = `${frontmatter}${body}`;

  await fs.writeFile(filePath, nextContent, 'utf-8');
}

function buildSystemPrompt(standardTags) {
  return `You are an assistant that classifies meetings. Prioritize using the following standard tags when applicable: ${standardTags.join(', ')}. You may introduce new lowercase kebab-case tags when necessary. Return a concise JSON payload with a "tags" array describing the meeting type. Limit to 3 tags. Never include explanations.`;
}

function buildMeetingContext(meeting, standardTags) {
  const attendees = normalizeAttendees(meeting.attendees);
  const transcript = typeof meeting.transcript === 'string' ? meeting.transcript : '';
  const notes = typeof meeting.notes === 'string' ? meeting.notes : '';
  const existingTags = Array.isArray(meeting.tags) ? meeting.tags.filter((tag) => typeof tag === 'string').join(', ') : 'None';

  return `Classify the following meeting.

Title: ${meeting.title || 'Untitled'}
Date: ${meeting.date || meeting.updatedAt || meeting.createdAt || 'Unknown'}
Attendees (${attendees.length}): ${attendees.join(', ') || 'Not listed'}
Status: ${meeting.status || 'unknown'}
Meeting URL: ${meeting.meetingUrl || 'N/A'}
Existing Tags: ${existingTags || 'None'}

Suggested Tags: ${standardTags.join(', ')}

Notes:
${notes || 'None'}

Transcript:
${transcript || 'No transcript available'}

Return JSON: {"tags": ["tag-one", "tag-two"]}`;
}

function parseJsonBlock(text) {
  const cleaned = text.replace(/```json|```/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    return null;
  }
}

function extractTagsFromResponse(response) {
  const content = Array.isArray(response?.content) ? response.content : [];
  const firstText = content.find((item) => item?.type === 'text');
  if (!firstText || typeof firstText.text !== 'string') {
    return [];
  }

  const payload = parseJsonBlock(firstText.text.trim());
  if (!payload || !Array.isArray(payload.tags)) {
    return [];
  }

  return payload.tags
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
}

function resolveFilePath(meeting, storagePath) {
  if (meeting.filePath && path.isAbsolute(meeting.filePath)) {
    return meeting.filePath;
  }
  if (meeting.filePath) {
    return path.join(storagePath, meeting.filePath);
  }
  return null;
}

async function generateTagsForMeeting({ meeting, anthropic, standardTags, systemPrompt }) {
  try {
    const userPrompt = buildMeetingContext(meeting, standardTags);
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 256,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt
        }
      ]
    });

    const parsed = extractTagsFromResponse(response);
    if (parsed.length > 0) {
      return parsed;
    }
  } catch (error) {
    console.error(`Anthropic request failed for ${meeting.id}:`, error.message || error);
  }

  return deriveFallbackTags(meeting);
}

async function main() {
  const [{ storagePath, anthropicApiKey }, standardTags, cache] = await Promise.all([
    (async () => resolveConfig())(),
    loadStandardTags(),
    loadMeetingsCache()
  ]);

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });
  const systemPrompt = buildSystemPrompt(standardTags);

  const meetingsWithTranscript = cache
    .filter((meeting) => typeof meeting.transcript === 'string' && meeting.transcript.trim().length > 0)
    .map((meeting) => ({
      ...meeting,
      parsedDate: new Date(meeting.date || meeting.updatedAt || meeting.createdAt || 0)
    }))
    .filter((meeting) => !Number.isNaN(meeting.parsedDate.getTime()))
    .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());

  if (meetingsWithTranscript.length === 0) {
    console.log('No meetings with transcripts found.');
    return;
  }

  const updates = [];
  for (const meeting of meetingsWithTranscript) {
    const filePath = resolveFilePath(meeting, storagePath);
    if (!filePath) {
      console.warn(`Skipping ${meeting.id}: missing file path`);
      continue;
    }

    try {
      await fs.access(filePath);
    } catch (error) {
      console.warn(`Skipping ${meeting.id}: file not found at ${filePath}`);
      continue;
    }

    const tags = await generateTagsForMeeting({ meeting, anthropic, standardTags, systemPrompt });

    try {
      await updateMeetingFile(filePath, tags);
      updates.push({ id: meeting.id, tags, filePath });
      console.log(`Updated ${filePath}: [${tags.join(', ')}]`);
    } catch (error) {
      console.error(`Failed to update ${filePath}:`, error.message || error);
    }
  }

  if (updates.length === 0) {
    console.log('No meeting files were updated.');
    return;
  }

  const updatesById = new Map(updates.map((item) => [item.id, item.tags]));
  const updatedCache = cache.map((meeting) => {
    if (updatesById.has(meeting.id)) {
      return {
        ...meeting,
        tags: updatesById.get(meeting.id)
      };
    }
    return meeting;
  });

  await fs.writeFile(MEETINGS_CACHE_PATH, `${JSON.stringify(updatedCache, null, 2)}\n`, 'utf-8');

  console.log(`\nCompleted tag backfill for ${updates.length} meetings.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
