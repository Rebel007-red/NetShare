import { useEffect, useState } from 'react';
import {
  formatBytes,
  formatDateTime,
  getInlineFileUrl,
  getRemainingLabel,
  getWorkspaceStats,
} from '../services/workspaceService';
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

function getFileLabel(file) {
  const mimeType = String(file?.mimeType ?? '').toLowerCase();
  if (mimeType.startsWith('image/')) return 'Image';
  if (mimeType.startsWith('video/')) return 'Video';
  if (mimeType.startsWith('audio/')) return 'Audio';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('msi') || mimeType.includes('x-msdownload')) return 'Installer';
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('tar')) return 'Archive';
  return getFileExtension(file?.name);
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
}) {
  const stats = getWorkspaceStats(workspace);
  const files = (workspace.items ?? []).filter((item) => item.type === 'file');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(workspace.name);
  const [showShare, setShowShare] = useState(false);

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
            <span className="nfs-workspace-status">{getRemainingLabel(workspace)}</span>
          </div>
          <div className="nfs-workspace-card__meta-inline">
            <span>{stats.files} files</span>
            <span>{stats.folders} folders</span>
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
            <button type="button" className="nfs-btn nfs-btn--ghost nfs-btn--compact" onClick={() => onExtend?.(workspace.code)}>
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
            <div key={file.id ?? file.path} className="nfs-workspace-card__file-item">
              <div className="nfs-workspace-card__file-shine" />
              <div className="nfs-workspace-card__file-glow" />
              <div className="nfs-workspace-card__file-content">
                <span className="nfs-workspace-card__file-badge">{getFileExtension(file.name)}</span>
                <div className="nfs-workspace-card__preview">
                  {isImageFile(file) ? (
                    <img src={getInlineFileUrl(workspace.code, file)} alt={file.name} loading="lazy" />
                  ) : (
                    <span className="nfs-workspace-card__file-type">{getFileLabel(file)}</span>
                  )}
                </div>
                <div className="nfs-workspace-card__file-text">
                  <p className="nfs-workspace-card__file-title" title={file.path}>{file.name}</p>
                  <p className="nfs-workspace-card__file-description">
                    {file.parentPath === '/' ? getFileLabel(file) : file.parentPath}
                  </p>
                </div>
                <div className="nfs-workspace-card__file-footer">
                  <span className="nfs-workspace-card__file-size">{formatBytes(file.size)}</span>
                  <div className="nfs-workspace-card__file-actions">
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
                </div>
              </div>
            </div>
          ))
        )}
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
}) {
  const [isJoining, setIsJoining] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const canJoin = joinCode.trim().length === 6;

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
            <span className="nfs-panel__tag">Files</span>
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

        <div className="nfs-workspace-stack">
          {isLoading ? (
            <div className="nfs-recent__empty">Loading workspaces…</div>
          ) : ordered.length === 0 ? (
            <div className="nfs-recent__empty">No workspaces yet. Create one to start sharing.</div>
          ) : (
            <div className="nfs-workspace-grid">
              {ordered.map((workspace) => (
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
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
