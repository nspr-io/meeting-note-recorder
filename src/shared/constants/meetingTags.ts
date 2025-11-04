export const STANDARD_MEETING_TAGS = [
  'sales',
  'customer-support',
  'product-demo',
  'onboarding',
  'interview',
  'renewal',
  'account-strategy',
  'product-feedback',
  'engineering-sync',
  'standup',
  'retrospective',
  'planning',
  'leadership',
  'partner',
  'training',
  'internal-ops'
] as const;

export type StandardMeetingTag = (typeof STANDARD_MEETING_TAGS)[number];
