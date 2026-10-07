import { formatDateTime } from '../services/apiClient';

const SENTENCES = {
  created: () => 'Created',
  folder: (detail) => `Folder "${detail}" added`,
  uploaded: (detail) => `Uploaded ${detail}`,
  renamed: (detail) => `Renamed ${detail}`,
  deleted: (detail) => `Deleted ${detail}`,
  'renamed-workspace': (detail) => `Workspace renamed to "${detail}"`,
  extended: () => 'Lifetime extended',
  kept: () => 'Set to never expire',
  unkept: () => 'Expiry restored',
  edited: () => 'Text edited',
  details: () => 'Title or format changed',
  'live-on': () => 'Live editing turned on',
  'live-off': () => 'Live editing turned off',
  restored: (detail) => `Restored ${detail || 'an earlier version'}`,
  'pin-set': () => 'PIN set',
  'pin-cleared': () => 'PIN removed',
};

function describe(entry) {
  const sentence = SENTENCES[entry.type]?.(entry.detail) ?? entry.type;
  return entry.count > 1 ? `${sentence} (${entry.count} times)` : sentence;
}

/**
 * A short history of what happened and when. There are no accounts, so entries
 * deliberately say nothing about who did it. `onOpen` lets a page that keeps the
 * log in memory refresh it at the moment someone looks.
 */
export default function ActivityLog({ activity = [], onOpen }) {
  return (
    <details
      className="nfs-activity"
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen?.();
      }}
    >
      <summary>Activity</summary>
      {activity.length === 0 ? (
        <p className="nfs-activity__empty">Nothing has happened yet.</p>
      ) : (
        <ol className="nfs-activity__list">
          {activity.map((entry, index) => (
            <li key={`${entry.at}-${entry.type}-${index}`}>
              <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
              <span>{describe(entry)}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
