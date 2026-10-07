import { useEffect, useState } from 'react';
import { isExpiringSoon } from '../services/apiClient';
import {
  formatBytes,
  formatDateTime,
  getInlineFileUrl,
  getRemainingLabel,
  getWorkspaceStats,
  getZipUrl,
} from '../services/workspaceService';
import ExpiryBanner from './ExpiryBanner';
import QrPanel from './QrPanel';
import ShareCodeField from './ShareCodeField';
import { DownloadIcon, OpenIcon, RemoveIcon } from './icons';

function isImageFile(file) {
  const mimeType = String(file?.mimeType ?? '').toLowerCase();
  if (mimeType.startsWith('image/')) return !mimeType.includes('svg');
  // SVGs are skipped on purpose: they can carry script and are served inline.
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(String(file?.name ?? ''));
}

function getFileExtension(fileName) {
  const parts = String(fileName ?? '').split('.');
  if (parts.length < 2) return 'FILE';
  return parts.at(-1).slice(0, 4).toUpperCase();
}

function WorkspaceCard({
  workspace,
  shareUrlFor,
  onOpen,
  onAddFiles,
  onDelete,
  onRenameWorkspace,
  onDownloadFile,
  onRemoveFile,
  onExtend,
  onTogglePersistent,
  onToast,
  soonMs,
}) {
  const stats = getWorkspaceStats(workspace);
  const files = (workspace.items ?? []).filter((item) => item.type === 'file');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(workspace.name);
  const [showShare, setShowShare] = useState(false);
  const soon = isExpiringSoon(workspace, soonMs);

  useEffect(() => {
    setDraftTitle(workspace.name);
  }, [workspace.name]);

  const commitTitle = async () => {
    const normalized = draftTitle.trim();
    setIsEditingTitle(false);
    if (!normalized || normalized === workspace.name) {
      setDraftTitle(workspace.name);
      return;
    }
    await onRenameWorkspace?.(workspace.code, normalized);
  };

  return (
    <article className="nfs-workspace-card nfs-workspace-card--list">
      <div className="nfs-workspace-card__head">
        <div className="nfs-workspace-card__title-group">
          <div className="nfs-workspace-card__title-line">
            {isEditingTitle ? (
              <input
                className="nfs-workspace-card__title-input"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    setDraftTitle(workspace.name);
                    setIsEditingTitle(false);
                  }
                }}
                maxLength={120}
                autoFocus
              />
            ) : (
              <button
                type="button"
                className="nfs-workspace-card__title-btn"
                onClick={() => setIsEditingTitle(true)}
                title="Rename workspace"
              >
                <h3>{workspace.name}</h3>
              </button>
            )}
            <span className={`nfs-workspace-status${soon ? ' nfs-workspace-status--soon' : ''}`}>
              {getRemainingLabel(workspace)}
            </span>
            {workspace.hasPin ? <span className="nfs-pin-badge">PIN</span> : null}
          </div>
          <div className="nfs-workspace-card__meta-inline">
            <span>{stats.files} {stats.files === 1 ? 'file' : 'files'}</span>
            {stats.folders > 0 ? <span>{stats.folders} {stats.folders === 1 ? 'folder' : 'folders'}</span> : null}
            <span>{formatBytes(stats.totalBytes)}</span>
            <span>{formatDateTime(workspace.createdAt)}</span>
          </div>
        </div>

        <div className="nfs-workspace-card__head-actions">
          <button type="button" className="nfs-code-pill nfs-code-pill--button" onClick={() => setShowShare((value) => !value)}>
            {workspace.code}
          </button>
          <div className="nfs-workspace-card__controls">
            <button type="button" className="nfs-btn nfs-btn--secondary nfs-btn--compact" onClick={() => onOpen(workspace.code)}>
              <OpenIcon />
              <span>Open</span>
            </button>
            <button type="button" className="nfs-btn nfs-btn--ghost nfs-btn--compact" onClick={() => onAddFiles?.(workspace.code)}>
              Add files
            </button>
            {files.length > 0 ? (
              <a className="nfs-btn nfs-btn--ghost nfs-btn--compact" href={getZipUrl(workspace.code)} download>
                ZIP
              </a>
            ) : null}
            <button
              type="button"
              className={`nfs-btn nfs-btn--compact ${soon ? 'nfs-btn--primary' : 'nfs-btn--ghost'}`}
              onClick={() => onExtend?.(workspace.code)}
            >
              Extend
            </button>
            <label className="nfs-workspace-card__toggle">
              <input
                type="checkbox"
                checked={Boolean(workspace.isPersistent)}
                onChange={(event) => onTogglePersistent?.(workspace.code, event.target.checked)}
              />
              <span>Keep</span>
            </label>
            <button
              type="button"
              className="nfs-btn nfs-btn--ghost nfs-btn--compact nfs-btn--compact-danger"
              onClick={() => onDelete(workspace.code)}
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {showShare ? (
        <div className="nfs-workspace-card__share">
          <div className="nfs-workspace-card__share-fields">
            <ShareCodeField
              value={workspace.code}
              label="Workspace code"
              onCopied={(ok) => onToast?.(ok
                ? { type: 'success', title: 'Code copied', message: `${workspace.code} is ready to share.` }
                : { type: 'error', title: 'Copy failed', message: 'Copy the code from the field instead.' })}
            />
            <ShareCodeField
              value={shareUrlFor(workspace.code)}
              label="Invite link"
              monospace={false}
              onCopied={(ok) => onToast?.(ok
                ? { type: 'success', title: 'Link copied', message: 'The invite link opens this workspace directly.' }
                : { type: 'error', title: 'Copy failed', message: 'Copy the link from the field instead.' })}
            />
          </div>
          <QrPanel
            value={shareUrlFor(workspace.code)}
            filename={`netfileshare-${workspace.code}`}
            caption={workspace.code}
          />
        </div>
      ) : null}

      <div className="nfs-workspace-card__files">
        {files.length === 0 ? (
          <span className="nfs-workspace-card__file-empty">No files yet</span>
        ) : (
          files.map((file) => (
            <div key={file.id ?? file.path} className="nfs-file-row">
              {isImageFile(file) ? (
                <img className="nfs-file-row__thumb" src={getInlineFileUrl(workspace.code, file)} alt="" loading="lazy" />
              ) : (
                <span className="nfs-file-row__type">{getFileExtension(file.name)}</span>
              )}
              <span className="nfs-file-row__name" title={file.path}>{file.name}</span>
              <span className="nfs-file-row__size">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="nfs-mini-btn nfs-mini-btn--icon"
                onClick={() => onDownloadFile?.(workspace.code, file)}
                aria-label={`Download ${file.name}`}
                title="Download"
              >
                <DownloadIcon />
              </button>
              <button
                type="button"
                className="nfs-mini-btn nfs-mini-btn--icon nfs-mini-btn--danger"
                onClick={() => onRemoveFile?.(workspace.code, file.path)}
                aria-label={`Remove ${file.name}`}
                title="Remove"
              >
                <RemoveIcon />
              </button>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

function LockedWorkspaceCard({ workspace, onUnlock }) {
  return (
    <article className="nfs-workspace-card nfs-locked">
      <div className="nfs-workspace-card__title-line">
        <h3>{workspace.name}</h3>
        <span className="nfs-pin-badge">PIN</span>
      </div>
      <div className="nfs-workspace-card__head-actions">
        <span className="nfs-code-pill">{workspace.code}</span>
        <button type="button" className="nfs-btn nfs-btn--secondary nfs-btn--compact" onClick={() => onUnlock(workspace.code)}>
          Unlock
        </button>
      </div>
    </article>
  );
}

export default function WorkspaceHome({
  joinCode,
  onJoinCodeChange,
  onCreate,
  onJoin,
  workspaces,
  isLoading,
  selectedWorkspace,
  shareUrlFor,
  onOpen,
  onAddFiles,
  onDeleteRecent,
  onRenameWorkspace,
  onDownloadFile,
  onRemoveFile,
  onExtendWorkspace,
  onToggleWorkspacePersistent,
  onToast,
  soonMs,
  onExtendMany,
  onUnlock,
}) {
  const [isJoining, setIsJoining] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const canJoin = joinCode.trim().length === 6;
  const expiring = workspaces.filter((item) => !item.locked && isExpiringSoon(item, soonMs));

  // Keep the active workspace at the top of the list.
  const ordered = [...workspaces].sort((left, right) => {
    const selected = selectedWorkspace?.code;
    if (!selected) return 0;
    if (left.code === selected) return -1;
    if (right.code === selected) return 1;
    return 0;
  });

  return (
    <div className="nfs-panel-stack">
      <section className="nfs-panel nfs-panel--flush">
        <div className="nfs-section-head nfs-section-head--compact">
          <div>
            <h2>Workspaces</h2>
            <p className="nfs-panel__hint">
              Share the 6-character code or the invite link. Anyone holding it has full access to the workspace.
            </p>
          </div>
          <div className="nfs-home-header__actions">
            <button
              type="button"
              className="nfs-btn nfs-btn--primary"
              disabled={isCreating}
              onClick={async () => {
                setIsCreating(true);
                await onCreate();
                setIsCreating(false);
              }}
            >
              {isCreating ? 'Creating' : 'Create'}
            </button>
            {!isJoining ? (
              <button type="button" className="nfs-btn nfs-btn--secondary" onClick={() => setIsJoining(true)}>
                Join
              </button>
            ) : (
              <form
                className="nfs-join-inline"
                onSubmit={async (event) => {
                  event.preventDefault();
                  // Only close the form once the join actually succeeded.
                  if (await onJoin()) setIsJoining(false);
                }}
              >
                <input
                  value={joinCode}
                  onChange={(event) => onJoinCodeChange(event.target.value.toUpperCase())}
                  placeholder="Enter code"
                  maxLength={6}
                  autoFocus
                />
                <button type="submit" className="nfs-btn nfs-btn--secondary" disabled={!canJoin}>Join</button>
                <button
                  type="button"
                  className="nfs-btn nfs-btn--ghost"
                  onClick={() => {
                    setIsJoining(false);
                    onJoinCodeChange('');
                  }}
                >
                  Cancel
                </button>
              </form>
            )}
          </div>
        </div>

        <ExpiryBanner
          count={expiring.length}
          noun="workspace"
          onExtendAll={() => onExtendMany(expiring.map((item) => item.code))}
        />

        <div className="nfs-workspace-stack">
          {isLoading ? (
            <div className="nfs-recent__empty">Loading workspaces…</div>
          ) : ordered.length === 0 ? (
            <div className="nfs-recent__empty">No workspaces yet. Create one to start sharing.</div>
          ) : (
            <div className="nfs-workspace-grid">
              {ordered.map((workspace) => (workspace.locked ? (
                <LockedWorkspaceCard key={workspace.code} workspace={workspace} onUnlock={onUnlock} />
              ) : (
                <WorkspaceCard
                  key={workspace.id ?? workspace.code}
                  workspace={workspace}
                  shareUrlFor={shareUrlFor}
                  onOpen={onOpen}
                  onAddFiles={onAddFiles}
                  onDelete={onDeleteRecent}
                  onRenameWorkspace={onRenameWorkspace}
                  onDownloadFile={onDownloadFile}
                  onRemoveFile={onRemoveFile}
                  onExtend={onExtendWorkspace}
                  onTogglePersistent={onToggleWorkspacePersistent}
                  onToast={onToast}
                  soonMs={soonMs}
                />
              )))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
