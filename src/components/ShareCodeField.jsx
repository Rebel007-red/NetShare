import { useEffect, useState } from 'react';
import { copyToClipboard } from '../services/apiClient';
import { CopyIcon } from './icons';

/**
 * A read-only value with a copy button that confirms inline. Used for share
 * codes, short URLs and note links so copying never needs a toast.
 */
export default function ShareCodeField({ value, label, monospace = true, onCopied }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    setCopied(ok);
    onCopied?.(ok, value);
  };

  return (
    <div className="nfs-share-field">
      {label ? <span className="nfs-share-field__label">{label}</span> : null}
      <div className="nfs-share-field__row">
        <input
          className={`nfs-share-field__input${monospace ? ' nfs-share-field__input--mono' : ''}`}
          value={value ?? ''}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
          aria-label={label ?? 'Share value'}
        />
        <button
          type="button"
          className={`nfs-btn nfs-btn--ghost nfs-btn--compact${copied ? ' nfs-btn--ok' : ''}`}
          onClick={handleCopy}
        >
          <CopyIcon />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}
