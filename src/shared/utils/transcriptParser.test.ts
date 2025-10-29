import { parseTranscript } from './transcriptParser';

describe('parseTranscript', () => {
  it('parses structured timestamps with speakers', () => {
    const input = `[14:33:43] Joshua Wohle: Hello everyone.\n14:34:01] Janine: Hi Joshua!`;

    const segments = parseTranscript(input);

    expect(segments).toEqual([
      { time: '14:33:43', speaker: 'Joshua Wohle', text: 'Hello everyone.' },
      { time: '14:34:01', speaker: 'Janine', text: 'Hi Joshua!' }
    ]);
  });

  it('extracts speaker names from device-prefixed labels', () => {
    const input = `14:33:43 Joshua Wohle - Mindstone: Good to see you.\n14:34:01 iPhone (janine): Thanks! Glad to be here.`;

    const segments = parseTranscript(input);

    expect(segments).toEqual([
      { time: '14:33:43', speaker: 'Joshua Wohle - Mindstone', text: 'Good to see you.' },
      { time: '14:34:01', speaker: 'Janine', text: 'Thanks! Glad to be here.' }
    ]);
  });

  it('does not split when colon appears in the message body', () => {
    const input = `14:35:00 Joshua: The key point is: focus on growth.`;

    const segments = parseTranscript(input);

    expect(segments).toEqual([
      {
        time: '14:35:00',
        speaker: 'Joshua',
        text: 'The key point is: focus on growth.'
      }
    ]);
  });

  it('uses previous speaker when continuation arrives without timestamp', () => {
    const input = `14:36:00 Janine: Following up on action items.\nAnd the budget review is next week.`;

    const segments = parseTranscript(input);

    expect(segments).toEqual([
      {
        time: '14:36:00',
        speaker: 'Janine',
        text: 'Following up on action items. And the budget review is next week.'
      }
    ]);
  });
});
