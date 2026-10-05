import { useEffect, useState } from 'react';
import { copyToClipboard, formatBytes, formatDateTime, getRemainingLabel } from '../services/apiClient';
import { fetchNoteOrThrow, getDownloadUrl } from '../services/noteService';
import NoteContent from './NoteContent';
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
                onClick={async () => setCopied(await copyToClipboard(note.content ?? ''))}
              >
                {copied ? 'Copied' : 'Copy text'}
              </button>
              <a className="nfs-btn nfs-btn--ghost nfs-btn--compact" href={getDownloadUrl(note.code)}>
                <DownloadIcon />
                <span>Download</span>
              </a>
            </>
          ) : null}
          <button type="button" className="nfs-btn nfs-btn--secondary nfs-btn--compact" onClick={onExit}>
            Open NetFileShare
          </button>
        </div>
      </header>

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
        </section>
      )}
    </div>
  );
}
