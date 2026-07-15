export type MentionOption = {
  id: string;
  name: string;
  label: string;
  color: string;
  ai?: boolean;
};

export type MentionRange = {
  start: number;
  end: number;
};

export type MentionFragment = MentionRange & {
  query: string;
};

export function mentionMatches(option: MentionOption, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return !normalizedQuery
    || option.label.toLowerCase().includes(normalizedQuery)
    || option.name.toLowerCase().includes(normalizedQuery);
}

export function mentionFragmentAt(value: string, cursor: number): MentionFragment | null {
  const prefix = value.slice(0, cursor);
  const match = prefix.match(/(^|\s)@([A-Za-z0-9_-]*)$/);
  if (!match) return null;

  const query = match[2] ?? '';
  return {
    query,
    start: cursor - query.length - 1,
    end: cursor
  };
}

export function insertMentionText(value: string, label: string, range: MentionRange) {
  const prefix = value.slice(0, range.start);
  const suffix = value.slice(range.end);
  const leadingSpace = prefix.length > 0 && !/\s$/.test(prefix) ? ' ' : '';
  const trailingSpace = suffix.length === 0 || !/^\s/.test(suffix) ? ' ' : '';
  const insertedText = `${leadingSpace}@${label}${trailingSpace}`;

  return {
    value: `${prefix}${insertedText}${suffix}`,
    cursor: prefix.length + insertedText.length
  };
}
