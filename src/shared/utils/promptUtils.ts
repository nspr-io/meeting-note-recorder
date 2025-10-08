import { UserProfile, Meeting } from '../types';

export interface PromptVariables {
  userProfile?: UserProfile | null;
  meeting?: Meeting;
  transcript?: string;
  notes?: string;
  meetingNotes?: string;
}

/**
 * Interpolates variables in a prompt template using {{variable}} syntax
 */
export function interpolatePrompt(template: string, variables: PromptVariables): string {
  let result = template;

  // Handle userProfile variables
  if (variables.userProfile) {
    result = result.replace(/\{\{userProfile\.name\}\}/g, variables.userProfile.name || '');
    result = result.replace(/\{\{userProfile\.title\}\}/g, variables.userProfile.title || '');
    result = result.replace(/\{\{userProfile\.company\}\}/g, variables.userProfile.company || '');
    result = result.replace(/\{\{userProfile\.aboutMe\}\}/g, variables.userProfile.aboutMe || '');
    result = result.replace(/\{\{userProfile\.preferences\}\}/g, variables.userProfile.preferences || '');
  }

  // Handle meeting variables
  if (variables.meeting) {
    result = result.replace(/\{\{meeting\.title\}\}/g, variables.meeting.title || '');
    result = result.replace(/\{\{meeting\.date\}\}/g, new Date(variables.meeting.date).toLocaleDateString() || '');

    // Handle attendees array
    const attendeesList = Array.isArray(variables.meeting.attendees)
      ? variables.meeting.attendees.map(a => typeof a === 'string' ? a : a.name).join(', ')
      : '';
    result = result.replace(/\{\{meeting\.attendees\}\}/g, attendeesList);
  }

  // Handle transcript and notes
  result = result.replace(/\{\{transcript\}\}/g, variables.transcript || '');
  result = result.replace(/\{\{notes\}\}/g, variables.notes || '');
  result = result.replace(/\{\{meetingNotes\}\}/g, variables.meetingNotes || '');

  // Handle conditional blocks for userProfile
  if (variables.userProfile) {
    // Replace {{#if userProfile}} blocks
    result = result.replace(/\{\{#if userProfile\}\}([\s\S]*?)\{\{\/if\}\}/g, '$1');
  } else {
    // Remove {{#if userProfile}} blocks if no userProfile
    result = result.replace(/\{\{#if userProfile\}\}[\s\S]*?\{\{\/if\}\}/g, '');
  }

  return result;
}

/**
 * Extracts all variable names from a prompt template
 */
export function extractVariables(template: string): string[] {
  const variableRegex = /\{\{([^}]+)\}\}/g;
  const variables = new Set<string>();
  let match;

  while ((match = variableRegex.exec(template)) !== null) {
    const variable = match[1].trim();
    // Skip conditional blocks
    if (!variable.startsWith('#') && !variable.startsWith('/')) {
      variables.add(variable);
    }
  }

  return Array.from(variables).sort();
}

/**
 * Validates that a prompt template has valid syntax
 */
export function validatePromptTemplate(template: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Define valid variables
  const validVariables = new Set([
    'userProfile.name',
    'userProfile.title',
    'userProfile.company',
    'userProfile.aboutMe',
    'userProfile.preferences',
    'meeting.title',
    'meeting.date',
    'meeting.attendees',
    'transcript',
    'notes',
    'meetingNotes'
  ]);

  // Check for unclosed conditional blocks
  const ifBlocks = (template.match(/\{\{#if/g) || []).length;
  const endifBlocks = (template.match(/\{\{\/if\}\}/g) || []).length;

  if (ifBlocks !== endifBlocks) {
    errors.push('Mismatched {{#if}} and {{/if}} blocks');
  }

  // Check for invalid variable syntax
  const invalidVars = template.match(/\{\{[^}]*\{\{|\}\}[^}]*\}\}/g);
  if (invalidVars) {
    errors.push('Invalid variable syntax found');
  }

  // Check for invalid variable names
  const variables = extractVariables(template);
  const invalidVariables = variables.filter(variable => !validVariables.has(variable));

  if (invalidVariables.length > 0) {
    errors.push(`Unknown variables: ${invalidVariables.join(', ')}`);
  }

  // Check for malformed variables (empty, only spaces, etc.)
  const malformedVars = template.match(/\{\{\s*\}\}/g);
  if (malformedVars) {
    errors.push('Empty variable placeholders found');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}