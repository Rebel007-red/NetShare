import { useEffect, useState } from 'react';
import { formatBytes, formatDateTime } from '../services/apiClient';
import { getVersion, listVersions, restoreVersion } from '../services/noteService';

const REASONS = {
  auto: 'Auto-saved',
  'before replace': 'Before an edit',
  'before large deletion': 'Before a large deletion',
  'before restore': 'Before a restore',
};

/**
 * Earlier texts of a note, newest first. Restoring one saves the current text
 * first, so even a mistaken restore can be undone from this same list.
 */
export default function NoteHistory({ code, onRestored, onClose, onToast }) {
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState('');
  const [openText, setOpenText] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    let cancelled = false;
    listVersions(code)
      .then((list) => {
        if (!cancelled) setVersions(list);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load history.');
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const toggleView = async (id) => {
    if (openId === id) {
      setOpenId('');
      return;
    }
    try {
      const version = await getVersion(code, id);
      setOpenText(version.content);
      setOpenId(id);
    } catch (viewError) {
      onToast?.({ type: 'error', title: 'Could not open version', message: viewError instanceof Error ? viewError.message : 'Try again.' });
    }
  };

  const restore = async (id) => {
    if (!window.confirm('Restore this version? The current text is saved first, so you can undo this.')) return;
    setBusyId(id);
    try {
      const note = await restoreVersion(code, id);
      onRestored?.(note);
      onToast?.({ type: 'success', title: 'Version restored', message: 'The earlier text is back. The text it replaced is in this list.' });
      setVersions(await listVersions(code));
      setOpenId('');
    } catch (restoreError) {
      onToast?.({ type: 'error', title: 'Restore failed', message: restoreError instanceof Error ? restoreError.message : 'Try again.' });
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="nfs-history" aria-label="Version history">
      <div className="nfs-history__head">
        <h2>Version history</h2>
        <button type="button" className="nfs-btn nfs-btn--ghost nfs-btn--compact" onClick={onClose}>Close</button>
      </div>

      {error ? <p className="nfs-field__error">{error}</p> : null}
      {versions === null && !error ? <p className="nfs-activity__empty">Loading…</p> : null}
      {versions?.length === 0 ? (
        <p className="nfs-activity__empty">
          No earlier versions yet. One is saved automatically before big changes and every couple of minutes while people edit.
        </p>
      ) : null}

      <ul className="nfs-history__list">
        {(versions ?? []).map((version) => (
          <li key={version.id} className="nfs-history__item">
            <div className="nfs-history__meta">
              <time dateTime={version.at}>{formatDateTime(version.at)}</time>
              <span>{REASONS[version.reason] ?? 'Saved'}</span>
              <span>{formatBytes(version.size)}</span>
            </div>
            <p className="nfs-history__preview">{version.preview}</p>
            <div className="nfs-history__actions">
              <button type="button" className="nfs-btn nfs-btn--ghost nfs-btn--compact" onClick={() => toggleView(version.id)}>
                {openId === version.id ? 'Hide' : 'View'}
              </button>
              <button
                type="button"
                className="nfs-btn nfs-btn--secondary nfs-btn--compact"
                disabled={busyId === version.id}
                onClick={() => restore(version.id)}
              >
                {busyId === version.id ? 'Restoring' : 'Restore'}
              </button>
            </div>
            {openId === version.id ? (
              <pre className="nfs-note-content nfs-note-content--raw"><code>{openText}</code></pre>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
