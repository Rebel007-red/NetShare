import { useEffect, useState } from 'react';
import { formatDateTime, getRemainingLabel } from '../services/apiClient';
import { getShortUrl, isValidAlias, toIsoFromLocalInput } from '../services/linkService';
import QrPanel from './QrPanel';
import ShareCodeField from './ShareCodeField';
import { OpenIcon, RemoveIcon, RenameIcon } from './icons';

const EMPTY_FORM = { targetUrl: '', alias: '', title: '', expiresAt: '' };

function LinkRow({ link, onDelete, onUpdate, onToast }) {
  const shortUrl = getShortUrl(link);
  const [showQr, setShowQr] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTarget, setDraftTarget] = useState(link.targetUrl);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraftTarget(link.targetUrl);
  }, [link.targetUrl]);

  const commit = async () => {
    const next = draftTarget.trim();
    if (!next || next === link.targetUrl) {
      setDraftTarget(link.targetUrl);
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    const ok = await onUpdate(link.slug, { targetUrl: next });
    setIsSaving(false);
    if (ok) setIsEditing(false);
    else setDraftTarget(link.targetUrl);
  };

  return (
    <article className="nfs-link-card">
      <div className="nfs-link-card__head">
        <div className="nfs-link-card__identity">
          <span className="nfs-code-pill nfs-code-pill--slug">/s/{link.slug}</span>
          <span className="nfs-workspace-status">{getRemainingLabel(link)}</span>
        </div>
        <div className="nfs-link-card__controls">
          <button
            type="button"
            className={`nfs-btn nfs-btn--ghost nfs-btn--compact${showQr ? ' nfs-btn--active' : ''}`}
            onClick={() => setShowQr((value) => !value)}
            aria-expanded={showQr}
          >
            QR
          </button>
          <a
            className="nfs-btn nfs-btn--ghost nfs-btn--compact"
            href={shortUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <OpenIcon />
            <span>Test</span>
          </a>
          <button
            type="button"
            className="nfs-btn nfs-btn--ghost nfs-btn--compact"
            onClick={() => setIsEditing((value) => !value)}
          >
            <RenameIcon />
            <span>Retarget</span>
          </button>
          <button
            type="button"
            className="nfs-btn nfs-btn--ghost nfs-btn--compact nfs-btn--compact-danger"
            onClick={() => onDelete(link.slug)}
          >
            <RemoveIcon />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {link.title ? <p className="nfs-link-card__title">{link.title}</p> : null}

      {isEditing ? (
        <form
          className="nfs-link-card__edit"
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <input
            value={draftTarget}
            onChange={(event) => setDraftTarget(event.target.value)}
            placeholder="https://new-destination.example.com"
            autoFocus
          />
          <button type="submit" className="nfs-btn nfs-btn--secondary nfs-btn--compact" disabled={isSaving}>
            {isSaving ? 'Saving' : 'Save'}
          </button>
          <button
            type="button"
            className="nfs-btn nfs-btn--ghost nfs-btn--compact"
            onClick={() => {
              setDraftTarget(link.targetUrl);
              setIsEditing(false);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <a className="nfs-link-card__target" href={link.targetUrl} target="_blank" rel="noopener noreferrer nofollow">
          {link.targetUrl}
        </a>
      )}

      <ShareCodeField
        value={shortUrl}
        label="Short URL"
        monospace={false}
        onCopied={(ok) => onToast?.(ok
          ? { type: 'success', title: 'Copied', message: 'The short URL is ready to share.' }
          : { type: 'error', title: 'Copy failed', message: 'Copy the URL from the field instead.' })}
      />

      <div className="nfs-link-card__stats">
        <div>
          <span>Clicks</span>
          <strong>{link.clicks}</strong>
        </div>
        <div>
          <span>Last visit</span>
          <strong>{link.lastVisitedAt ? formatDateTime(link.lastVisitedAt) : 'Never'}</strong>
        </div>
        <div>
          <span>Created</span>
          <strong>{formatDateTime(link.createdAt)}</strong>
        </div>
      </div>

      {showQr ? <QrPanel value={shortUrl} filename={`netfileshare-${link.slug}`} caption={`/s/${link.slug}`} /> : null}
    </article>
  );
}

export default function LinkManager({ links, isLoading, onCreate, onDelete, onUpdate, onToast }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [isCreating, setIsCreating] = useState(false);
  const [aliasError, setAliasError] = useState('');

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    if (field === 'alias') setAliasError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.targetUrl.trim()) return;

    if (form.alias.trim() && !isValidAlias(form.alias)) {
      setAliasError('Use 2-64 letters, numbers, dashes or underscores, starting with a letter or number.');
      return;
    }

    setIsCreating(true);
    const ok = await onCreate({
      targetUrl: form.targetUrl,
      alias: form.alias,
      title: form.title,
      expiresAt: toIsoFromLocalInput(form.expiresAt),
    });
    setIsCreating(false);
    if (ok) setForm(EMPTY_FORM);
  };

  return (
    <div className="nfs-panel-stack">
      <section className="nfs-panel">
        <div className="nfs-section-head nfs-section-head--compact">
          <div>
            <h2>New short link</h2>
            <p className="nfs-panel__hint">
              Short links never expire unless you set a date. Anyone with the short URL can open the destination.
            </p>
          </div>
        </div>

        <form className="nfs-link-form" onSubmit={handleSubmit}>
          <label className="nfs-field nfs-field--wide">
            <span>Destination URL</span>
            <input
              value={form.targetUrl}
              onChange={update('targetUrl')}
              placeholder="https://internal.example.com/very/long/path"
              inputMode="url"
              required
            />
          </label>
          <label className="nfs-field">
            <span>Custom alias <em>optional</em></span>
            <input value={form.alias} onChange={update('alias')} placeholder="release-notes" maxLength={64} />
            {aliasError ? <small className="nfs-field__error">{aliasError}</small> : null}
          </label>
          <details className="nfs-more nfs-field--wide">
            <summary>More options</summary>
            <div className="nfs-more__fields">
            <label className="nfs-field">
              <span>Label <em>optional</em></span>
              <input value={form.title} onChange={update('title')} placeholder="Q3 release notes" maxLength={120} />
            </label>
            <label className="nfs-field">
              <span>Expires <em>optional</em></span>
              <input type="datetime-local" value={form.expiresAt} onChange={update('expiresAt')} />
            </label>
              </div>
          </details>
          <div className="nfs-link-form__actions">
            <button type="submit" className="nfs-btn nfs-btn--primary" disabled={isCreating || !form.targetUrl.trim()}>
              {isCreating ? 'Creating' : 'Create short link'}
            </button>
          </div>
        </form>
      </section>

      <section className="nfs-panel">
        <div className="nfs-section-head nfs-section-head--compact">
          <div>
            <h2>Your short links</h2>
            <p className="nfs-panel__hint">Remembered in this browser only — copy a short URL to keep it.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="nfs-recent__empty">Loading short links…</div>
        ) : links.length === 0 ? (
          <div className="nfs-recent__empty">No short links yet. Create one above.</div>
        ) : (
          <div className="nfs-link-grid">
            {links.map((link) => (
              <LinkRow
                key={link.id ?? link.slug}
                link={link}
                onDelete={onDelete}
                onUpdate={onUpdate}
                onToast={onToast}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
