import { useState } from 'react';
import { copyToClipboard } from '../services/apiClient';
import { buildBackup, countBackup, restoreBackup } from '../services/backupService';

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Your list of workspaces, notes and links is remembered by this browser only.
 * This panel saves it to a file (or the clipboard) and loads it back, so a new
 * laptop or cleared site data does not mean losing track of your own things.
 */
export default function BackupPanel({ onRestored, onToast }) {
  const [text, setText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState('');

  const exportFile = () => {
    const backup = buildBackup();
    if (countBackup(backup) === 0) {
      setMessage('There is nothing to back up yet.');
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'netfileshare-codes.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`Saved ${plural(countBackup(backup), 'code')}. Keep the file private: anyone with these codes can open them.`);
  };

  const copyBackup = async () => {
    const backup = buildBackup();
    if (countBackup(backup) === 0) {
      setMessage('There is nothing to back up yet.');
      return;
    }
    const ok = await copyToClipboard(JSON.stringify(backup, null, 2));
    setMessage(ok ? 'Copied. Paste it somewhere safe.' : 'Copying was blocked. Use Save to file instead.');
  };

  const readFile = async (event) => {
    // Copy first: the FileList is live and is emptied when the input is cleared.
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!file) return;
    try {
      setText(await file.text());
      setMessage(`Loaded ${file.name}. Press Restore to add its codes.`);
    } catch {
      setMessage('That file could not be read.');
    }
  };

  const restore = async () => {
    setIsBusy(true);
    try {
      const result = await restoreBackup(text);
      const restored = result.workspaces + result.notes + result.links;
      const parts = [plural(result.workspaces, 'workspace'), plural(result.notes, 'note'), plural(result.links, 'link')];
      setMessage(
        `Restored ${parts.join(', ')}.` +
        (result.skipped.length ? ` ${plural(result.skipped.length, 'code')} expired or could not be found: ${result.skipped.join(', ')}.` : ''),
      );
      if (restored > 0) {
        setText('');
        await onRestored?.();
        onToast?.({ type: 'success', title: 'Codes restored', message: `Added ${plural(restored, 'item')} to this browser.` });
      }
    } catch (restoreError) {
      setMessage(restoreError instanceof Error ? restoreError.message : 'Could not restore.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <details className="nfs-backup">
      <summary>Back up or restore my codes</summary>
      <div className="nfs-backup__body">
        <p className="nfs-panel__hint">
          This browser is the only place that remembers which workspaces, notes and links are yours.
          Save them so a new device or cleared site data does not lose them.
        </p>
        <div className="nfs-backup__row">
          <button type="button" className="nfs-btn nfs-btn--secondary nfs-btn--compact" onClick={exportFile}>Save to file</button>
          <button type="button" className="nfs-btn nfs-btn--ghost nfs-btn--compact" onClick={copyBackup}>Copy</button>
        </div>
        <label className="nfs-field">
          <span>Restore from a file, or paste codes</span>
          <textarea
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste a backup or a list of codes"
            spellCheck={false}
          />
        </label>
        <div className="nfs-backup__row">
          <label className="nfs-btn nfs-btn--ghost nfs-btn--compact nfs-backup__file">
            Choose file
            <input type="file" accept="application/json,.json,.txt" hidden onChange={readFile} />
          </label>
          <button type="button" className="nfs-btn nfs-btn--primary nfs-btn--compact" disabled={isBusy || !text.trim()} onClick={restore}>
            {isBusy ? 'Restoring' : 'Restore'}
          </button>
        </div>
        {message ? <p className="nfs-backup__message" role="status">{message}</p> : null}
      </div>
    </details>
  );
}
