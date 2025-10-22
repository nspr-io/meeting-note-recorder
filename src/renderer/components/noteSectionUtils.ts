export interface NoteSections {
  calendarInfo: string;
  prepNotes: string;
  meetingNotes: string;
}

const CALENDAR_START = '<!-- CALENDAR_INFO -->';
const CALENDAR_END = '<!-- /CALENDAR_INFO -->';
const PREP_START = '<!-- PREP_NOTES -->';
const PREP_END = '<!-- /PREP_NOTES -->';

interface ExtractResult {
  content: string;
  remaining: string;
}

const extractBlock = (source: string, start: string, end: string): ExtractResult => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return { content: '', remaining: source };
  }

  const before = source.slice(0, startIndex);
  const between = source.slice(startIndex + start.length, endIndex);
  const after = source.slice(endIndex + end.length);

  return {
    content: between.trim(),
    remaining: `${before}${after}`
  };
};

export const extractNoteSections = (notes: string | undefined | null): NoteSections => {
  const original = typeof notes === 'string' ? notes : '';

  const calendarExtraction = extractBlock(original, CALENDAR_START, CALENDAR_END);
  const prepExtraction = extractBlock(calendarExtraction.remaining, PREP_START, PREP_END);

  return {
    calendarInfo: calendarExtraction.content,
    prepNotes: prepExtraction.content,
    meetingNotes: prepExtraction.remaining.trim()
  };
};

export const combineNoteSections = ({
  calendarInfo,
  prepNotes,
  meetingNotes
}: NoteSections): string => {
  const segments: string[] = [];

  const calendar = calendarInfo.trim();
  const prep = prepNotes.trim();
  const meeting = meetingNotes.trim();

  if (calendar) {
    segments.push(`${CALENDAR_START}\n${calendar}\n${CALENDAR_END}`);
  }

  if (prep) {
    segments.push(`${PREP_START}\n${prep}\n${PREP_END}`);
  }

  if (meeting) {
    segments.push(meeting);
  }

  return segments.join('\n\n').trim();
};

export const hasSectionChanges = (
  sections: NoteSections,
  originalNotes: string | undefined | null
): boolean => {
  const combined = combineNoteSections(sections);
  const baseline = typeof originalNotes === 'string' ? originalNotes.trim() : '';
  return combined !== baseline;
};
