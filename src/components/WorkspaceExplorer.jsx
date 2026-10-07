import { useState } from 'react';
import {
  buildBreadcrumbs,
  formatBytes,
  getChildren,
  getRemainingLabel,
  getWorkspaceStats,
  getZipUrl,
} from '../services/workspaceService';
import ActivityLog from './ActivityLog';
import ShareCodeField from './ShareCodeField';
import { DownloadIcon, FileIcon, FolderIcon, RemoveIcon, RenameIcon } from './icons';

function WorkspaceStats({ workspace }) {
  const stats = getWorkspaceStats(workspace);
  return (
    <div className="nfs-stats">
      <div><strong>{stats.files}</strong><span>{stats.files === 1 ? 'File' : 'Files'}</span></div>
      <div><strong>{stats.folders}</strong><span>{stats.folders === 1 ? 'Folder' : 'Folders'}</span></div>
      <div><strong>{formatBytes(stats.totalBytes)}</strong><span>Stored</span></div>
      <div><strong>{getRemainingLabel(workspace)}</strong><span>Lifetime</span></div>
    </div>
  );
}

function ItemCard({ item, onOpenFolder, onDownload, onDelete, onRename }) {
  const isFolder = item.type === 'folder';

  return (
    <article className="nfs-item-card">
      {isFolder ? (
        <button type="button" className="nfs-item-card__main" onClick={() => onOpenFolder(item.path)}>
          <span className="nfs-item-card__icon nfs-item-card__icon--folder"><FolderIcon /></span>
          <span className="nfs-item-card__copy">
            <strong>{item.name}</strong>
            <span>Folder</span>
          </span>
        </button>
      ) : (
        <div className="nfs-item-card__main nfs-item-card__main--static">
          <span className="nfs-item-card__icon nfs-item-card__icon--file"><FileIcon /></span>
          <span className="nfs-item-card__copy">
            <strong title={item.name}>{item.name}</strong>
            <span>{formatBytes(item.size)} · {item.mimeType ?? 'file'}</span>
          </span>
        </div>
      )}
      <div className="nfs-item-card__actions">
        {!isFolder ? (
          <button type="button" className="nfs-mini-btn" onClick={() => onDownload(item)}>
            <DownloadIcon />
            <span>Download</span>
          </button>
        ) : null}
        <button type="button" className="nfs-mini-btn" onClick={() => onRename(item)}>
          <RenameIcon />
          <span>Rename</span>
        </button>
        <button type="button" className="nfs-mini-btn nfs-mini-btn--danger" onClick={() => onDelete(item)}>
          <RemoveIcon />
          <span>Delete</span>
        </button>
      </div>
    </article>
  );
}

export default function WorkspaceExplorer({
  workspace,
  currentPath,
  newFolderName,
  shareUrl,
  onNewFolderNameChange,
  onCreateFolder,
  onNavigate,
  onBack,
  onExtend,
  onTogglePersistent,
  onDeleteWorkspace,
  onDownloadItem,
  onDeleteItem,
  onRenameItem,
  dragActive,
  onDragEnter,
  onDragLeave,
  onDrop,
  onFilePicker,
  onToast,
  uploadLimitLabel,
  lifetimeLabel,
  onSetPin,
}) {
  const breadcrumbs = buildBreadcrumbs(currentPath);
  const items = getChildren(workspace, currentPath);
  const [showShare, setShowShare] = useState(false);

  return (
    <div className="nfs-panel-stack">
      <section className="nfs-workspace-head">
        <div className="nfs-workspace-head__main">
          <button type="button" className="nfs-back-btn" onClick={onBack}>&larr; All workspaces</button>
          <h1>
            {workspace.name}
            {workspace.hasPin ? <span className="nfs-pin-badge">PIN</span> : null}
          </h1>
          <div className="nfs-code-row">
            <button
              type="button"
              className="nfs-code-pill nfs-code-pill--button"
              onClick={() => setShowShare((value) => !value)}
            >
              {workspace.code}
            </button>
            <span className="nfs-code-note">Share this code with anyone who should access the workspace.</span>
          </div>
          {showShare ? (
            <div className="nfs-workspace-card__share-fields">
              <ShareCodeField
                value={workspace.code}
                label="Workspace code"
                onCopied={(ok) => onToast?.(ok
                  ? { type: 'success', title: 'Code copied', message: `${workspace.code} is ready to share.` }
                  : { type: 'error', title: 'Copy failed', message: 'Copy the code from the field instead.' })}
              />
              <ShareCodeField
                value={shareUrl}
                label="Invite link"
                monospace={false}
                onCopied={(ok) => onToast?.(ok
                  ? { type: 'success', title: 'Link copied', message: 'The invite link opens this workspace directly.' }
                  : { type: 'error', title: 'Copy failed', message: 'Copy the link from the field instead.' })}
              />
            </div>
          ) : null}
        </div>
        <div className="nfs-workspace-head__side">
          <WorkspaceStats workspace={workspace} />
          <div className="nfs-workspace-head__actions">
            <button type="button" className="nfs-btn nfs-btn--secondary" onClick={onExtend}>
              Extend {lifetimeLabel ?? 'lifetime'}
            </button>
            <button
              type="button"
              className={`nfs-btn ${workspace.isPersistent ? 'nfs-btn--primary' : 'nfs-btn--ghost'}`}
              onClick={() => onTogglePersistent(!workspace.isPersistent)}
            >
              {workspace.isPersistent ? 'Disable permanent mode' : 'Make non-expiring'}
            </button>
            {workspace.items?.length > 0 ? (
              <a className="nfs-btn nfs-btn--ghost" href={getZipUrl(workspace.code)} download>
                Download all (.zip)
              </a>
            ) : null}
            <button type="button" className="nfs-btn nfs-btn--ghost" onClick={onSetPin}>
              {workspace.hasPin ? 'Remove PIN' : 'Set PIN'}
            </button>
            <button type="button" className="nfs-btn nfs-btn--danger" onClick={onDeleteWorkspace}>Delete workspace</button>
          </div>
        </div>
      </section>

      <section
        className={`nfs-dropzone${dragActive ? ' nfs-dropzone--active' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div>
          <h2>Drop files here or use the picker</h2>
          <p>
            Files land in {currentPath === '/' ? 'the root folder' : currentPath} and are downloadable by anyone
            with the workspace code.{uploadLimitLabel ? ` ${uploadLimitLabel}` : ''}
          </p>
        </div>
        <button type="button" className="nfs-btn nfs-btn--primary" onClick={onFilePicker}>Choose files</button>
      </section>

      <section className="nfs-toolbar">
        <div className="nfs-breadcrumbs">
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <span key={crumb.path} className="nfs-breadcrumbs__part">
                <button
                  type="button"
                  className={`nfs-breadcrumb${isLast ? ' nfs-breadcrumb--current' : ''}`}
                  onClick={() => onNavigate(crumb.path)}
                  disabled={isLast}
                >
                  {crumb.label}
                </button>
                {!isLast ? <span className="nfs-breadcrumb__sep">/</span> : null}
              </span>
            );
          })}
        </div>
        {currentPath !== '/' && items.length > 0 ? (
          <a className="nfs-btn nfs-btn--ghost nfs-btn--compact" href={getZipUrl(workspace.code, currentPath)} download>
            Download this folder (.zip)
          </a>
        ) : null}
        <form className="nfs-inline-form" onSubmit={onCreateFolder}>
          <input
            value={newFolderName}
            onChange={(event) => onNewFolderNameChange(event.target.value)}
            placeholder="New folder name"
            maxLength={120}
          />
          <button type="submit" className="nfs-btn nfs-btn--secondary" disabled={!newFolderName.trim()}>
            Create folder
          </button>
        </form>
      </section>

      <section className="nfs-browser">
        <div className="nfs-browser__head">
          <h2>{currentPath === '/' ? 'Root folder' : currentPath}</h2>
        </div>
        {items.length === 0 ? (
          <div className="nfs-empty-state">
            <strong>Nothing here yet.</strong>
            <span>Create a folder or upload files into this workspace.</span>
          </div>
        ) : (
          <div className="nfs-item-grid">
            {items.map((item) => (
              <ItemCard
                key={item.id ?? item.path}
                item={item}
                onOpenFolder={onNavigate}
                onDownload={onDownloadItem}
                onDelete={onDeleteItem}
                onRename={onRenameItem}
              />
            ))}
          </div>
        )}
      </section>

      <section className="nfs-panel">
        <ActivityLog activity={workspace.activity} />
      </section>
    </div>
  );
}
