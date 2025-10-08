# Transcript Duplication Bug - Fix Summary

## Date Fixed
2025-10-06

## Bug Description

Meeting transcripts were being duplicated multiple times in files, resulting in 4-8+ copies of the same transcript content. This happened progressively during meeting recordings.

### Example Corruption
A file would contain:
```
# Transcript
[content 123 lines]
---
# Transcript
[content 138 lines]
---
# Transcript
[content 123 lines]
---
# Transcript
[content 138 lines]
```

## Root Cause Analysis

### Primary Bug (Line 493)
The `updateMeeting` method used a regex that captured ALL transcript sections to end of file:

```typescript
// BUGGY
const transcriptMatch = bodyContent.match(/# Transcript\s+([\s\S]*?)$/);
```

The `$` anchor means "end of string", so `[\s\S]*?` matched EVERYTHING from the first `# Transcript` to the end, including all duplicate sections.

### Trigger Mechanism
1. **fetchFinalTranscriptInBackground** (line 1102-1132) polls up to 10 times for final transcript
2. Each poll calls `updateTranscript` → `updateMeeting`
3. `updateMeeting` reads file with buggy regex
4. Regex captures ALL existing duplicates
5. Length comparison keeps the longer (corrupted) version
6. `formatMeetingToMarkdown` writes it back with header prepended
7. Result: Progressive multiplication of transcript sections

### Evidence
- File analysis showed alternating section lengths (123 vs 138 timestamps)
- This proved two transcript versions being interleaved
- 8 total sections = multiple polling iterations creating duplicates

## The Fix

**File**: `src/main/services/StorageService.ts`
**Lines Changed**: 489-529

### Before (Buggy)
```typescript
const notesMatch = bodyContent.match(/# Meeting Notes\s+([\s\S]*?)(?=\n---\n# Transcript|$)/);
const transcriptMatch = bodyContent.match(/# Transcript\s+([\s\S]*?)$/);

if (notesMatch && notesMatch[1].trim()) {
  const fileNotes = notesMatch[1].trim();
  // ... process notes
}

if (transcriptMatch && transcriptMatch[1].trim()) {
  if (!updatedMeeting.transcript || updatedMeeting.transcript.trim().length < transcriptMatch[1].trim().length) {
    updatedMeeting.transcript = transcriptMatch[1].trim();
  }
}
```

### After (Fixed)
```typescript
// Use the same proven parsing logic as loadMeetingFromFile
// This prevents capturing duplicate sections that may exist in corrupted files
const sections = bodyContent.split('---\n');
const notesSection = sections.find(s => s.includes('# Meeting Notes')) || '';
const transcriptSection = sections.find(s => s.includes('# Transcript')) || '';

const fileNotes = notesSection.replace('# Meeting Notes', '').trim();
const fileTranscript = transcriptSection.replace('# Transcript', '').trim();

if (fileNotes) {
  const cacheNotes = updatedMeeting.notes || '';
  // ... process notes
}

if (fileTranscript) {
  if (!updatedMeeting.transcript || updatedMeeting.transcript.trim().length < fileTranscript.length) {
    updatedMeeting.transcript = fileTranscript;
  }
}
```

## Why This Fix Works

1. **Consistency**: Uses the exact same parsing logic as `loadMeetingFromFile` (line 244), which was already proven to work
2. **Correct Behavior**: `.find()` returns ONLY the first matching section, ignoring all duplicates
3. **Simplicity**: No complex regex, easier to understand and maintain
4. **Robustness**: Handles both clean and corrupted files correctly

## Impact

### Before Fix
- Transcript duplicated 4-8+ times per meeting
- File sizes bloated (70KB+ for simple meetings)
- Polling iterations progressively multiplied duplicates
- Background transcript fetching made it worse

### After Fix
- Only first transcript section extracted, duplicates ignored
- No more progressive multiplication
- Clean files continue to work normally
- Corrupted files stop getting worse

## Testing

✅ Corrupted files: Extracts only first section
✅ Clean files: Works identically to before
✅ Edge cases: Handles varying section lengths
✅ Consistency: Matches `loadMeetingFromFile` behavior

## Related Issues

This fix also addresses the dollar sign corruption bug in the meeting-prep-storage MCP (separate fix applied).

## Prevention

Future improvements to consider:
1. Add validation to detect duplicate sections during write
2. Log warnings when duplicates are found
3. Add cleanup utility to fix existing corrupted files
4. Consider reducing polling frequency or removing background fetch entirely
