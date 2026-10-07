import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLiveNote } from '../hooks/useLiveNote';
import { copyToClipboard, formatBytes } from '../services/apiClient';
import NoteContent from './NoteContent';

const STATUS_LABEL = {
  saved: 'Saved',
  saving: 'Saving…',
  offline: 'Offline — retrying',
  disabled: 'Live editing was turned off',
  gone: 'This note is no longer available',
};

function EditorsPill({ count }) {
  if (count <= 1) return null;
  return <span className="nfs-live__editors">{count} people editing</span>;
}

/**
 * A note that stays in sync with everyone else looking at it.
 *
 * `editing` switches between a read-only live view (polls slowly, shows the
 * rendered note) and the editor (write pane plus live preview). The same sync
 * hook backs both, so toggling never loses text or the base it merges against.
 */
export default function LiveDocument({ note, editing, view = 'rendered', onViewChange, onMeta, maxBytes = 0 }) {
  const textareaRef = useRef(null);
  const [pane, setPane] = useState('write');
  const [copied, setCopied] = useState(false);

  const { text, setText, meta, status, editors, notice, dismissNotice, consumeSelection } = useLiveNote({
    code: note.code,
    initial: note,
    readOnly: !editing,
    textareaRef,
  });

  const preview = useDeferredValue(text);
  const previewNote = { ...meta, content: preview };
  const bytes = new TextEncoder().encode(text).length;
  const overLimit = maxBytes > 0 && bytes > maxBytes;
  const locked = status === 'disabled' || status === 'gone';
  const hasPreview = meta.format !== 'text';

  // Put the caret back where the remote edit pushed it.
  useLayoutEffect(() => {
    const target = consumeSelection();
    const field = textareaRef.current;
    if (target && field) field.setSelectionRange(target[0], target[1]);
  }, [text, consumeSelection]);

  // Keep the page header (title, size, updated) current.
  useEffect(() => {
    onMeta?.(meta);
  }, [meta, onMeta]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const statusClass = `nfs-live__status nfs-live__status--${status}`;

  return (
    <div className="nfs-live">
      <div className="nfs-live__bar">
        <span className={statusClass} role="status" aria-live="polite">
          <span className="nfs-live__dot" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </span>
        <EditorsPill count={editors} />
        {editing ? (
          <span className={`nfs-live__size${overLimit ? ' nfs-live__size--over' : ''}`}>
            {formatBytes(bytes)}{maxBytes > 0 ? ` of ${formatBytes(maxBytes)}` : ''}
          </span>
        ) : null}
        {!editing && meta.format !== 'text' ? (
          <div className="nfs-segmented nfs-live__view">
            <button type="button" className={view === 'rendered' ? 'is-active' : ''} onClick={() => onViewChange?.('rendered')}>
              {meta.format === 'markdown' ? 'Rendered' : 'Formatted'}
            </button>
            <button type="button" className={view === 'raw' ? 'is-active' : ''} onClick={() => onViewChange?.('raw')}>
              Raw
            </button>
          </div>
        ) : null}
      </div>

      {notice?.type === 'rejected' ? (
        <div className="nfs-live__notice" role="alert">
          <p>
            Part of your last edit could not be merged because someone changed the same text at the same
            time. Check the document, and copy your version if you need it back.
          </p>
          <div className="nfs-live__notice-actions">
            <button
              type="button"
              className="nfs-btn nfs-btn--ghost nfs-btn--compact"
              onClick={async () => setCopied(await copyToClipboard(notice.text))}
            >
              {copied ? 'Copied' : 'Copy my version'}
            </button>
            <button type="button" className="nfs-btn nfs-btn--ghost nfs-btn--compact" onClick={dismissNotice}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <>
          {hasPreview ? (
            <div className="nfs-segmented nfs-live__tabs" role="tablist" aria-label="Editor panes">
              <button type="button" role="tab" aria-selected={pane === 'write'} className={pane === 'write' ? 'is-active' : ''} onClick={() => setPane('write')}>
                Write
              </button>
              <button type="button" role="tab" aria-selected={pane === 'preview'} className={pane === 'preview' ? 'is-active' : ''} onClick={() => setPane('preview')}>
                Preview
              </button>
            </div>
          ) : null}
          <div className={`nfs-live__panes${hasPreview ? ' nfs-live__panes--split' : ''}`} data-pane={pane}>
            <textarea
              ref={textareaRef}
              className={`nfs-live__textarea${meta.format === 'text' ? ' nfs-live__textarea--prose' : ''}`}
              value={text}
              onChange={(event) => setText(event.target.value)}
              readOnly={locked}
              spellCheck={meta.format !== 'code'}
              aria-label="Shared document"
              placeholder={meta.format === 'markdown' ? '# Start writing…' : 'Start typing…'}
            />
            {hasPreview ? (
              <div className="nfs-live__preview">
                <NoteContent note={previewNote} view="rendered" />
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <NoteContent note={previewNote} view={view} />
      )}
    </div>
  );
}
