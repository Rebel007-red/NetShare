import { useEffect, useMemo, useState } from 'react';
import { formatBytes, formatDateTime, getRemainingLabel, isExpiringSoon } from '../services/apiClient';
import ExpiryBanner from './ExpiryBanner';
import { NOTE_FORMATS, NOTE_LANGUAGES, getDownloadUrl, getNoteShareUrl } from '../services/noteService';
import NoteContent from './NoteContent';
import QrPanel from './QrPanel';
import ShareCodeField from './ShareCodeField';
import { DownloadIcon, OpenIcon, RemoveIcon } from './icons';

const EMPTY_DRAFT = {
  title: '',
  content: '',
  format: 'markdown',
  language: 'plaintext',
  isPersistent: false,
  isCollaborative: false,
};

function NoteEditorFields({ draft, onChange, maxBytes }) {
  const bytes = useMemo(() => new TextEncoder().encode(draft.content).length, [draft.content]);
  const overLimit = maxBytes > 0 && bytes > maxBytes;

  return (
    <>
      <div className="nfs-note-form__row">
        <label className="nfs-field nfs-field--wide">
          <span>Title</span>
          <input
            value={draft.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="Deployment runbook"
            maxLength={120}
          />
        </label>
        <label className="nfs-field">
          <span>Format</span>
          <select value={draft.format} onChange={(event) => onChange({ format: event.target.value })}>
            {NOTE_FORMATS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {draft.format === 'code' ? (
          <label className="nfs-field">
            <span>Language</span>
            <select value={draft.language} onChange={(event) => onChange({ language: event.target.value })}>
              {NOTE_LANGUAGES.map((language) => (
                <option key={language} value={language}>{language}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <label className="nfs-field nfs-field--wide">
        <span>Content</span>
        <textarea
          className="nfs-note-textarea"
          value={draft.content}
          onChange={(event) => onChange({ content: event.target.value })}
          placeholder={draft.format === 'markdown' ? '# Heading\n\nWrite markdown here.' : 'Paste text here.'}
          rows={5}
          spellCheck={draft.format !== 'code'}
        />
        <small className={`nfs-field__meter${overLimit ? ' nfs-field__meter--over' : ''}`}>
          {formatBytes(bytes)}
          {maxBytes > 0 ? ` of ${formatBytes(maxBytes)}` : ''}
        </small>
      </label>
    </>
  );
}

function NoteCard({ note, onDelete, onExtend, onTogglePersistent, onToggleCollaborative, onSetPin, onUpdate, onToast, maxBytes, soonMs }) {
  const shareUrl = getNoteShareUrl(note);
  const soon = isExpiringSoon(note, soonMs);
  const [view, setView] = useState('rendered');
  const [showQr, setShowQr] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState(() => ({
    title: note.title,
    content: note.content ?? '',
    format: note.format,
    language: note.language ?? 'plaintext',
  }));

  useEffect(() => {
    if (isEditing) return;
    setDraft({
      title: note.title,
      content: note.content ?? '',
      format: note.format,
      language: note.language ?? 'plaintext',
    });
  }, [isEditing, note.title, note.content, note.format, note.language]);

  const handleSave = async () => {
    setIsSaving(true);
    const ok = await onUpdate(note.code, {
      title: draft.title,
      content: draft.content,
      format: draft.format,
      language: draft.format === 'code' ? draft.language : null,
    });
    setIsSaving(false);
    if (ok) setIsEditing(false);
  };

  return (
    <article className="nfs-note-card">
      <div className="nfs-note-card__head">
        <div className="nfs-note-card__identity">
          <h3>{note.title}</h3>
          <div className="nfs-note-card__badges">
            <span className="nfs-code-pill">{note.code}</span>
            <span className="nfs-note-card__badge">{note.format}</span>
            {note.isCollaborative ? <span className="nfs-live-badge">Live</span> : null}
            {note.format === 'code' && note.language ? (
              <span className="nfs-note-card__badge">{note.language}</span>
            ) : null}
            <span className={`nfs-workspace-status${soon ? ' nfs-workspace-status--soon' : ''}`}>
              {getRemainingLabel(note)}
            </span>
            {note.hasPin ? <span className="nfs-pin-badge">PIN</span> : null}
          </div>
        </div>
        <div className="nfs-note-card__controls">
          <button
            type="button"
            className={`nfs-btn nfs-btn--compact ${soon ? 'nfs-btn--primary' : 'nfs-btn--ghost'}`}
            onClick={() => onExtend(note.code)}
          >
            Extend
          </button>
          <label className="nfs-workspace-card__toggle">
            <input
              type="checkbox"
              checked={Boolean(note.isPersistent)}
              onChange={(event) => onTogglePersistent(note.code, event.target.checked)}
            />
            <span>Keep</span>
          </label>
          <label className="nfs-workspace-card__toggle" title="Let anyone with the link edit this note together">
            <input
              type="checkbox"
              checked={Boolean(note.isCollaborative)}
              onChange={(event) => onToggleCollaborative(note.code, event.target.checked)}
            />
            <span>Live</span>
          </label>
          {note.isCollaborative ? (
            <a
              className="nfs-btn nfs-btn--ghost nfs-btn--compact"
              href={`/note/${note.code}?edit=1`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Edit live
            </a>
          ) : (
            <button
              type="button"
              className={`nfs-btn nfs-btn--ghost nfs-btn--compact${isEditing ? ' nfs-btn--active' : ''}`}
              onClick={() => setIsEditing((value) => !value)}
            >
              {isEditing ? 'Close editor' : 'Edit'}
            </button>
          )}
          <button
            type="button"
            className={`nfs-btn nfs-btn--ghost nfs-btn--compact${showQr ? ' nfs-btn--active' : ''}`}
            onClick={() => setShowQr((value) => !value)}
            aria-expanded={showQr}
          >
            QR
          </button>
          <button type="button" className="nfs-btn nfs-btn--ghost nfs-btn--compact" onClick={() => onSetPin(note.code, note.hasPin)}>
            {note.hasPin ? 'Remove PIN' : 'PIN'}
          </button>
          <button
            type="button"
            className="nfs-btn nfs-btn--ghost nfs-btn--compact nfs-btn--compact-danger"
            onClick={() => onDelete(note.code)}
          >
            <RemoveIcon />
            <span>Delete</span>
          </button>
        </div>
      </div>

      <ShareCodeField
        value={shareUrl}
        label="Share link"
        monospace={false}
        onCopied={(ok) => onToast?.(ok
          ? { type: 'success', title: 'Copied', message: 'Anyone with this link can read the note.' }
          : { type: 'error', title: 'Copy failed', message: 'Copy the link from the field instead.' })}
      />

      {isEditing && !note.isCollaborative ? (
        <div className="nfs-note-card__editor">
          <NoteEditorFields
            draft={draft}
            maxBytes={maxBytes}
            onChange={(changes) => setDraft((current) => ({ ...current, ...changes }))}
          />
          <div className="nfs-note-form__actions">
            <button
              type="button"
              className="nfs-btn nfs-btn--primary"
              onClick={handleSave}
              disabled={isSaving || !draft.content.trim()}
            >
              {isSaving ? 'Saving' : 'Save note'}
            </button>
            <button type="button" className="nfs-btn nfs-btn--ghost" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="nfs-note-card__viewbar">
            <div className="nfs-segmented">
              <button
                type="button"
                className={view === 'rendered' ? 'is-active' : ''}
                onClick={() => setView('rendered')}
              >
                {note.format === 'markdown' ? 'Rendered' : 'Formatted'}
              </button>
              <button type="button" className={view === 'raw' ? 'is-active' : ''} onClick={() => setView('raw')}>
                Raw
              </button>
            </div>
            <div className="nfs-note-card__viewbar-actions">
              <a className="nfs-btn nfs-btn--ghost nfs-btn--compact" href={shareUrl} target="_blank" rel="noopener noreferrer">
                <OpenIcon />
                <span>Open</span>
              </a>
              <a className="nfs-btn nfs-btn--ghost nfs-btn--compact" href={getDownloadUrl(note.code)}>
                <DownloadIcon />
                <span>Download</span>
              </a>
            </div>
          </div>
          <NoteContent note={note} view={view} />
        </>
      )}

      <div className="nfs-note-card__stats">
        <div><span>Size</span><strong>{formatBytes(note.size)}</strong></div>
        <div><span>Views</span><strong>{note.views}</strong></div>
        <div><span>Updated</span><strong>{formatDateTime(note.updatedAt)}</strong></div>
      </div>

      {showQr ? <QrPanel value={shareUrl} filename={`netfileshare-note-${note.code}`} caption={note.code} /> : null}
    </article>
  );
}

function LockedNoteCard({ note, onUnlock }) {
  return (
    <article className="nfs-note-card nfs-locked">
      <div className="nfs-note-card__identity">
        <h3>{note.title}</h3>
        <div className="nfs-note-card__badges">
          <span className="nfs-code-pill">{note.code}</span>
          <span className="nfs-pin-badge">PIN</span>
        </div>
      </div>
      <div>
        <button type="button" className="nfs-btn nfs-btn--secondary nfs-btn--compact" onClick={() => onUnlock(note.code)}>
          Unlock
        </button>
      </div>
    </article>
  );
}

export default function NoteManager({
  notes,
  isLoading,
  maxBytes,
  onCreate,
  onDelete,
  onExtend,
  onTogglePersistent,
  onToggleCollaborative,
  onSetPin,
  onUnlock,
  onExtendMany,
  soonMs,
  onUpdate,
  onOpenCode,
  onToast,
}) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [isCreating, setIsCreating] = useState(false);
  const [openCode, setOpenCode] = useState('');
  const expiring = notes.filter((item) => !item.locked && isExpiringSoon(item, soonMs));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!draft.content.trim()) return;

    setIsCreating(true);
    const ok = await onCreate({
      title: draft.title,
      content: draft.content,
      format: draft.format,
      language: draft.format === 'code' ? draft.language : null,
      isPersistent: draft.isPersistent,
      isCollaborative: draft.isCollaborative,
    });
    setIsCreating(false);
    if (ok) setDraft(EMPTY_DRAFT);
  };

  return (
    <div className="nfs-panel-stack">
      <section className="nfs-panel">
        <div className="nfs-section-head nfs-section-head--compact">
          <div>
            <h2>New note</h2>
            <p className="nfs-panel__hint">
              Markdown is rendered, code is highlighted, and anyone with the 6-character code can read it.
            </p>
          </div>
          <form
            className="nfs-join-inline"
            onSubmit={(event) => {
              event.preventDefault();
              onOpenCode(openCode).then((ok) => {
                if (ok) setOpenCode('');
              });
            }}
          >
            <input
              value={openCode}
              onChange={(event) => setOpenCode(event.target.value.toUpperCase())}
              placeholder="Open code"
              maxLength={6}
            />
            <button type="submit" className="nfs-btn nfs-btn--secondary" disabled={openCode.trim().length !== 6}>
              Open
            </button>
          </form>
        </div>

        <form className="nfs-note-form" onSubmit={handleSubmit}>
          <NoteEditorFields
            draft={draft}
            maxBytes={maxBytes}
            onChange={(changes) => setDraft((current) => ({ ...current, ...changes }))}
          />
          <div className="nfs-note-form__actions">
            <label className="nfs-workspace-card__toggle">
              <input
                type="checkbox"
                checked={draft.isPersistent}
                onChange={(event) => setDraft((current) => ({ ...current, isPersistent: event.target.checked }))}
              />
              <span>Never expires</span>
            </label>
            <label className="nfs-workspace-card__toggle" title="Let anyone with the link edit this note together">
              <input
                type="checkbox"
                checked={draft.isCollaborative}
                onChange={(event) => setDraft((current) => ({ ...current, isCollaborative: event.target.checked }))}
              />
              <span>Live editing</span>
            </label>
            <button type="submit" className="nfs-btn nfs-btn--primary" disabled={isCreating || !draft.content.trim()}>
              {isCreating ? 'Creating' : 'Create note'}
            </button>
          </div>
        </form>
      </section>

      <section className="nfs-panel">
        <div className="nfs-section-head nfs-section-head--compact">
          <div>
            <h2>Your notes</h2>
            <p className="nfs-panel__hint">Remembered in this browser only — copy a share link to keep it.</p>
          </div>
        </div>

        <ExpiryBanner
          count={expiring.length}
          noun="note"
          onExtendAll={() => onExtendMany(expiring.map((item) => item.code))}
        />

        {isLoading ? (
          <div className="nfs-recent__empty">Loading notes…</div>
        ) : notes.length === 0 ? (
          <div className="nfs-recent__empty">No notes yet. Create one above.</div>
        ) : (
          <div className="nfs-note-grid">
            {notes.map((note) => (note.locked ? (
              <LockedNoteCard key={note.code} note={note} onUnlock={onUnlock} />
            ) : (
              <NoteCard
                key={note.id ?? note.code}
                note={note}
                maxBytes={maxBytes}
                onDelete={onDelete}
                onExtend={onExtend}
                onTogglePersistent={onTogglePersistent}
                onToggleCollaborative={onToggleCollaborative}
                onSetPin={onSetPin}
                soonMs={soonMs}
                onUpdate={onUpdate}
                onToast={onToast}
              />
            )))}
          </div>
        )}
      </section>
    </div>
  );
}
