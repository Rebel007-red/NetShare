import { useCallback, useEffect, useState } from 'react';
import { copyToClipboard, formatBytes, formatDateTime, getRemainingLabel, getServerLimits } from '../services/apiClient';
import { fetchNoteOrThrow, getDownloadUrl, getNote, getRawUrl } from '../services/noteService';
import ActivityLog from './ActivityLog';
import LiveDocument from './LiveDocument';
import NoteContent from './NoteContent';
import NoteHistory from './NoteHistory';
import { DownloadIcon } from './icons';

/**
 * Standalone read view at /note/<CODE>, which is what a share link opens.
 * It is intentionally independent of the recent-codes list: a recipient has
 * only the link, not the creator's browser state.
 */
export default function NoteViewer({ code, onExit }) {
  const [note, setNote] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState('rendered');
  const [copied, setCopied] = useState(false);
  // A share link can open straight into the editor with ?edit=1.
  const [editing, setEditing] = useState(() => new URLSearchParams(window.location.search).get('edit') === '1');
  const [maxBytes, setMaxBytes] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [freshActivity, setFreshActivity] = useState(null);
  const [flash, setFlash] = useState('');

  /** The log is loaded with the note; refetch it at the moment someone opens it. */
  const refreshActivity = useCallback(async () => {
    const latest = await getNote(code);
    if (latest) setFreshActivity(latest.activity ?? []);
  }, [code]);

  useEffect(() => {
    getServerLimits().then((limits) => setMaxBytes(limits?.maxNoteBytes ?? 0));
  }, []);

  /** Live edits change the title, size and timestamp; keep the header in step. */
  const handleMeta = useCallback((meta) => {
    setNote((current) => (current ? { ...current, ...meta } : current));
  }, []);

  /** The copy button must give the current text, not what the page loaded with. */
  const handleCopy = async () => {
    let value = note.content ?? '';
    if (note.isCollaborative) {
      try {
        value = await (await fetch(getRawUrl(note.code), { cache: 'no-store' })).text();
      } catch {
        // Fall back to the text the page already has.
      }
    }
    setCopied(await copyToClipboard(value));
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError('');

    fetchNoteOrThrow(code)
      .then((loaded) => {
        if (!cancelled) setNote(loaded);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'This note is not available.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    document.title = note?.title ? `${note.title} · NetFileShare` : 'Shared note · NetFileShare';
    return () => {
      document.title = 'NetFileShare';
    };
  }, [note?.title]);

  return (
    <div className="nfs-shell nfs-shell--note">
      <header className="nfs-note-view__head">
        <div>
          <h1>{note?.title ?? (isLoading ? 'Loading…' : 'Shared note')}</h1>
          {note ? (
            <div className="nfs-note-view__meta">
              <span className="nfs-code-pill">{note.code}</span>
              <span className="nfs-note-card__badge">{note.format}</span>
              {note.format === 'code' && note.language ? (
                <span className="nfs-note-card__badge">{note.language}</span>
              ) : null}
              {note.isCollaborative ? <span className="nfs-live-badge">Live</span> : null}
              <span className="nfs-workspace-status">{getRemainingLabel(note)}</span>
              <span className="nfs-note-view__meta-dim">
                {formatBytes(note.size)} · updated {formatDateTime(note.updatedAt)}
              </span>
            </div>
          ) : null}
        </div>
        <div className="nfs-note-view__actions">
          {note ? (
            <>
              <button
                type="button"
                className={`nfs-btn nfs-btn--ghost nfs-btn--compact${copied ? ' nfs-btn--ok' : ''}`}
                onClick={handleCopy}
              >
                {copied ? 'Copied' : 'Copy text'}
              </button>
              <a className="nfs-btn nfs-btn--ghost nfs-btn--compact" href={getDownloadUrl(note.code)}>
                <DownloadIcon />
                <span>Download</span>
              </a>
              <button
                type="button"
                className={`nfs-btn nfs-btn--ghost nfs-btn--compact${showHistory ? ' nfs-btn--active' : ''}`}
                onClick={() => setShowHistory((value) => !value)}
                aria-expanded={showHistory}
              >
                History
              </button>
              {note.isCollaborative ? (
                <button
                  type="button"
                  className={`nfs-btn nfs-btn--compact ${editing ? 'nfs-btn--primary' : 'nfs-btn--secondary'}`}
                  onClick={() => setEditing((value) => !value)}
                >
                  {editing ? 'Done' : 'Edit'}
                </button>
              ) : null}
            </>
          ) : null}
          <button type="button" className="nfs-btn nfs-btn--ghost nfs-btn--compact" onClick={onExit}>
            Open NetFileShare
          </button>
        </div>
      </header>

      {showHistory && note ? (
        <NoteHistory
          code={note.code}
          onClose={() => setShowHistory(false)}
          onRestored={(restored) => setNote(restored)}
          onToast={(toast) => setFlash(toast.message)}
        />
      ) : null}
      {flash ? <p className="nfs-backup__message" role="status">{flash}</p> : null}

      {isLoading ? (
        <section className="nfs-panel">
          <div className="nfs-recent__empty">Loading note…</div>
        </section>
      ) : error ? (
        <section className="nfs-panel">
          <div className="nfs-empty-state">
            <strong>This note is not available.</strong>
            <span>{error}</span>
          </div>
        </section>
      ) : (
        <section className="nfs-panel">
          {note.isCollaborative ? (
            <LiveDocument
              key={note.code}
              note={note}
              editing={editing}
              view={view}
              onViewChange={setView}
              onMeta={handleMeta}
              maxBytes={maxBytes}
            />
          ) : (
            <>
              {note.format !== 'text' ? (
                <div className="nfs-note-card__viewbar">
                  <div className="nfs-segmented">
                    <button type="button" className={view === 'rendered' ? 'is-active' : ''} onClick={() => setView('rendered')}>
                      {note.format === 'markdown' ? 'Rendered' : 'Formatted'}
                    </button>
                    <button type="button" className={view === 'raw' ? 'is-active' : ''} onClick={() => setView('raw')}>
                      Raw
                    </button>
                  </div>
                </div>
              ) : null}
              <NoteContent note={note} view={view} />
            </>
          )}
        </section>
      )}

      {note ? (
        <section className="nfs-panel">
          <ActivityLog activity={freshActivity ?? note.activity} onOpen={refreshActivity} />
        </section>
      ) : null}
    </div>
  );
}
