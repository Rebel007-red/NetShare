import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseRoute, replacePath } from './lib/router';
import BackupPanel from './components/BackupPanel';
import LinkManager from './components/LinkManager';
import NoteManager from './components/NoteManager';
import NoteViewer from './components/NoteViewer';
import Toast from './components/Toast';
import WorkspaceExplorer from './components/WorkspaceExplorer';
import WorkspaceHome from './components/WorkspaceHome';
import { formatBytes, formatDuration, getServerLimits } from './services/apiClient';
import * as links from './services/linkService';
import * as notes from './services/noteService';
import * as workspaces from './services/workspaceService';

/** Mirrors NETFILESHARE_LIFETIME_HOURS' default; replaced by /api/health. */
const DEFAULT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const TABS = [
  { id: 'files', label: 'Files' },
  { id: 'links', label: 'Short links' },
  { id: 'notes', label: 'Notes' },
];

function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function App() {
  const [route, setRoute] = useState(() => parseRoute());
  const [tab, setTab] = useState('files');
  const [toast, setToast] = useState(null);
  const [limits, setLimits] = useState(null);

  const [workspaceList, setWorkspaceList] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [isWorkspaceView, setIsWorkspaceView] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [currentPath, setCurrentPath] = useState('/');
  const [dragActive, setDragActive] = useState(false);

  const [linkList, setLinkList] = useState([]);
  const [loadingLinks, setLoadingLinks] = useState(true);

  const [noteList, setNoteList] = useState([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  const fileInputRef = useRef(null);
  // Which workspace/path the hidden file input is currently acting on.
  const uploadTargetRef = useRef(null);

  const notify = useCallback((next) => setToast(next), []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    getServerLimits().then(setLimits);
  }, []);

  // Every expiry message is phrased from the server's configured lifetime.
  // Assume the server default until /api/health answers, so no label ever
  // renders as a placeholder on first paint.
  const lifetimeLabel = useMemo(
    () => formatDuration(limits?.lifetimeMs ?? DEFAULT_LIFETIME_MS),
    [limits],
  );

  // "Expiring soon" is a day, or a quarter of the lifetime if that is shorter, so
  // a deployment with a very short lifetime does not warn about everything.
  const soonMs = useMemo(
    () => Math.min(24 * 60 * 60 * 1000, (limits?.lifetimeMs ?? DEFAULT_LIFETIME_MS) / 4),
    [limits],
  );

  const uploadLimitLabel = useMemo(() => {
    if (!limits?.maxUploadBytes) return '';
    return `Each file must be ${formatBytes(limits.maxUploadBytes)} or smaller.`;
  }, [limits]);

  /* ---------------------------------------------------------------- loaders */

  const reloadWorkspaces = useCallback(async () => {
    setLoadingWorkspaces(true);
    try {
      const list = await workspaces.listWorkspaces();
      setWorkspaceList(list);
      return list;
    } finally {
      setLoadingWorkspaces(false);
    }
  }, []);

  const reloadLinks = useCallback(async () => {
    setLoadingLinks(true);
    try {
      setLinkList(await links.listLinks());
    } finally {
      setLoadingLinks(false);
    }
  }, []);

  const reloadNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      setNoteList(await notes.listNotes());
    } finally {
      setLoadingNotes(false);
    }
  }, []);

  useEffect(() => {
    if (route.name === 'note') return;
    reloadWorkspaces();
    reloadLinks();
    reloadNotes();
  }, [route.name, reloadWorkspaces, reloadLinks, reloadNotes]);

  /**
   * An invite link (/w/<CODE>) opens that workspace straight away, then cleans
   * the URL so a later refresh does not keep re-joining a deleted workspace.
   */
  useEffect(() => {
    if (route.name !== 'workspace') return;
    let cancelled = false;

    workspaces.getWorkspaceByCode(route.code).then((loaded) => {
      if (cancelled) return;
      replacePath('/');
      setRoute({ name: 'app' });
      if (!loaded) {
        notify({ type: 'error', title: 'Workspace unavailable', message: 'That invite link has expired.' });
        return;
      }
      workspaces.joinWorkspace(loaded.code).catch(() => undefined);
      setWorkspace(loaded);
      setCurrentPath('/');
      setIsWorkspaceView(true);
      setTab('files');
      reloadWorkspaces();
    });

    return () => {
      cancelled = true;
    };
  }, [route, notify, reloadWorkspaces]);

  /** Refreshes the open workspace, dropping it if the server forgot it. */
  const syncOpenWorkspace = useCallback(async (code) => {
    const latest = await workspaces.getWorkspaceByCode(code);
    if (latest) {
      setWorkspace(latest);
      setCurrentPath((path) => workspaces.resolveExistingPath(latest, path));
      return latest;
    }
    setWorkspace(null);
    setIsWorkspaceView(false);
    setCurrentPath('/');
    workspaces.clearLastWorkspaceCode();
    notify({ type: 'error', title: 'Workspace expired', message: 'The workspace is no longer available.' });
    return null;
  }, [notify]);

  const applyWorkspace = useCallback((next, message) => {
    setWorkspace((current) => (current?.code === next.code || !current ? next : current));
    setWorkspaceList((current) => current.map((item) => (item.code === next.code ? next : item)));
    if (message) notify(message);
  }, [notify]);

  /* ------------------------------------------------------------- workspaces */

  const handleCreateWorkspace = async () => {
    try {
      const created = await workspaces.createWorkspace({ name: '', isPersistent: false });
      await reloadWorkspaces();
      setWorkspace(created);
      setCurrentPath('/');
      notify({
        type: 'success',
        title: 'Workspace created',
        message: `Share code ${created.code} with other users.`,
      });
    } catch (error) {
      notify({ type: 'error', title: 'Create failed', message: errorMessage(error, 'Unable to create workspace.') });
    }
  };

  const handleJoinWorkspace = async () => {
    try {
      const joined = await workspaces.joinWorkspace(joinCode);
      setJoinCode('');
      setWorkspace(joined);
      setCurrentPath('/');
      setIsWorkspaceView(true);
      await reloadWorkspaces();
      notify({ type: 'success', title: 'Workspace opened', message: `Connected to ${joined.name}.` });
      return true;
    } catch (error) {
      notify({ type: 'error', title: 'Join failed', message: errorMessage(error, 'Unable to join workspace.') });
      return false;
    }
  };

  const handleOpenWorkspace = async (code) => {
    const opened = await workspaces.getWorkspaceByCode(code);
    if (!opened) {
      notify({ type: 'error', title: 'Unavailable', message: 'That workspace has expired.' });
      await reloadWorkspaces();
      return;
    }
    workspaces.joinWorkspace(opened.code).catch(() => undefined);
    setWorkspace(opened);
    setCurrentPath('/');
    setIsWorkspaceView(true);
  };

  const handleBackToList = () => {
    setIsWorkspaceView(false);
    setCurrentPath('/');
    setNewFolderName('');
    reloadWorkspaces();
  };

  const handleDeleteWorkspace = async (code) => {
    const target = workspaceList.find((item) => item.code === code) ?? workspace;
    const label = target?.name ? `"${target.name}"` : code;
    if (!window.confirm(`Delete workspace ${label} and all of its files? This cannot be undone.`)) return;

    try {
      await workspaces.deleteWorkspace(code);
      if (workspace?.code === code) {
        setWorkspace(null);
        setIsWorkspaceView(false);
        setCurrentPath('/');
      }
      await reloadWorkspaces();
      notify({ type: 'success', title: 'Workspace deleted', message: 'The workspace and all of its content were removed.' });
    } catch (error) {
      notify({ type: 'error', title: 'Delete failed', message: errorMessage(error, 'Unable to delete workspace.') });
    }
  };

  const runWorkspaceAction = async (action, { failureTitle, failureMessage, success }) => {
    try {
      applyWorkspace(await action(), success);
      return true;
    } catch (error) {
      notify({ type: 'error', title: failureTitle, message: errorMessage(error, failureMessage) });
      return false;
    }
  };

  const handleExtendWorkspace = (code) => runWorkspaceAction(
    () => workspaces.extendWorkspace(code),
    {
      failureTitle: 'Extend failed',
      failureMessage: 'Unable to extend workspace.',
      success: {
        type: 'success',
        title: 'Extended',
        message: `Workspace lifetime was extended by ${lifetimeLabel}.`,
      },
    },
  );

  const handleTogglePersistence = (code, nextValue) => runWorkspaceAction(
    () => workspaces.toggleWorkspacePersistence(code, nextValue),
    {
      failureTitle: 'Update failed',
      failureMessage: 'Unable to update workspace.',
      success: {
        type: 'success',
        title: nextValue ? 'Permanent mode enabled' : 'Expiry restored',
        message: nextValue
          ? 'This workspace will no longer expire automatically.'
          : `This workspace now expires in ${lifetimeLabel}.`,
      },
    },
  );

  const handleRenameWorkspace = (code, name) => runWorkspaceAction(
    () => workspaces.renameWorkspace(code, name),
    {
      failureTitle: 'Rename failed',
      failureMessage: 'Unable to rename workspace.',
      success: { type: 'success', title: 'Renamed', message: 'Workspace name was updated.' },
    },
  );

  const handleCreateFolder = async (event) => {
    event.preventDefault();
    if (!workspace || !newFolderName.trim()) return;
    const ok = await runWorkspaceAction(
      () => workspaces.createFolder(workspace.code, currentPath, newFolderName),
      {
        failureTitle: 'Folder failed',
        failureMessage: 'Unable to create folder.',
        success: { type: 'success', title: 'Folder created', message: 'The folder is now available in this workspace.' },
      },
    );
    if (ok) setNewFolderName('');
  };

  const handleUpload = async (fileList, target) => {
    const files = Array.from(fileList ?? []);
    const code = target?.code ?? workspace?.code;
    const path = target?.path ?? currentPath;
    if (!code || files.length === 0) return;

    const oversized = limits?.maxUploadBytes
      ? files.filter((file) => file.size > limits.maxUploadBytes)
      : [];
    if (oversized.length > 0) {
      notify({
        type: 'error',
        title: 'File too large',
        message: `${oversized[0].name} is ${formatBytes(oversized[0].size)}. The limit is ${formatBytes(limits.maxUploadBytes)}.`,
      });
      return;
    }

    try {
      const updated = await workspaces.uploadFiles(code, path, files);
      applyWorkspace(updated, {
        type: 'success',
        title: 'Files added',
        message: `${files.length} file${files.length > 1 ? 's were' : ' was'} uploaded.`,
      });
      if (workspace?.code !== code) await reloadWorkspaces();
    } catch (error) {
      notify({ type: 'error', title: 'Upload failed', message: errorMessage(error, 'Unable to upload files.') });
    }
  };

  const openFilePicker = (target) => {
    uploadTargetRef.current = target ?? null;
    fileInputRef.current?.click();
  };

  const handleDeleteItem = async (item) => {
    if (!workspace || !item) return;
    const isFolder = item.type === 'folder';
    const prompt = isFolder
      ? `Delete folder "${item.name}" and everything inside it?`
      : `Delete "${item.name}"?`;
    if (!window.confirm(prompt)) return;

    await runWorkspaceAction(
      () => workspaces.removeItem(workspace.code, item.path),
      {
        failureTitle: 'Delete failed',
        failureMessage: 'Unable to remove item.',
        success: { type: 'success', title: 'Removed', message: 'The selected item was removed.' },
      },
    );
    // The open folder may have been the thing that was deleted.
    await syncOpenWorkspace(workspace.code);
  };

  const handleRemoveFileFromHome = async (code, path) => {
    if (!window.confirm('Delete this file?')) return;
    await runWorkspaceAction(
      () => workspaces.removeItem(code, path),
      {
        failureTitle: 'Delete failed',
        failureMessage: 'Unable to remove file.',
        success: { type: 'success', title: 'Removed', message: 'The selected file was removed.' },
      },
    );
  };

  const handleRenameItem = async (item) => {
    if (!workspace || !item) return;
    const nextName = window.prompt('Enter a new name', item.name);
    if (nextName == null || !nextName.trim() || nextName === item.name) return;

    const ok = await runWorkspaceAction(
      () => workspaces.renameItem(workspace.code, item.path, nextName),
      {
        failureTitle: 'Rename failed',
        failureMessage: 'Unable to rename item.',
        success: { type: 'success', title: 'Renamed', message: 'The item name was updated.' },
      },
    );
    // Renaming the folder we are standing in changes its path, so re-resolve it.
    if (ok) await syncOpenWorkspace(workspace.code);
  };

  /* ------------------------------------------------------------- short links */

  const handleCreateLink = async (payload) => {
    try {
      const created = await links.createLink(payload);
      await reloadLinks();
      notify({ type: 'success', title: 'Short link ready', message: `/s/${created.slug} now points at your URL.` });
      return true;
    } catch (error) {
      notify({ type: 'error', title: 'Could not create link', message: errorMessage(error, 'Unable to create short link.') });
      return false;
    }
  };

  const handleUpdateLink = async (slug, changes) => {
    try {
      await links.updateLink(slug, changes);
      await reloadLinks();
      notify({ type: 'success', title: 'Link updated', message: `/s/${slug} now points somewhere new.` });
      return true;
    } catch (error) {
      notify({ type: 'error', title: 'Update failed', message: errorMessage(error, 'Unable to update short link.') });
      return false;
    }
  };

  const handleDeleteLink = async (slug) => {
    if (!window.confirm(`Delete /s/${slug}? Anyone using it will get a 404.`)) return;
    try {
      await links.deleteLink(slug);
      await reloadLinks();
      notify({ type: 'success', title: 'Link deleted', message: 'The short link no longer resolves.' });
    } catch (error) {
      notify({ type: 'error', title: 'Delete failed', message: errorMessage(error, 'Unable to delete short link.') });
    }
  };

  /* ------------------------------------------------------------------- notes */

  const handleCreateNote = async (payload) => {
    try {
      const created = await notes.createNote(payload);
      await reloadNotes();
      notify({ type: 'success', title: 'Note created', message: `Share code ${created.code} to let others read it.` });
      return true;
    } catch (error) {
      notify({ type: 'error', title: 'Could not create note', message: errorMessage(error, 'Unable to create note.') });
      return false;
    }
  };

  const handleUpdateNote = async (code, changes) => {
    try {
      await notes.updateNote(code, changes);
      await reloadNotes();
      notify({ type: 'success', title: 'Note saved', message: 'Everyone with the link sees the new version.' });
      return true;
    } catch (error) {
      notify({ type: 'error', title: 'Save failed', message: errorMessage(error, 'Unable to save note.') });
      return false;
    }
  };

  const handleDeleteNote = async (code) => {
    if (!window.confirm('Delete this note? Anyone holding the link will lose access.')) return;
    try {
      await notes.deleteNote(code);
      await reloadNotes();
      notify({ type: 'success', title: 'Note deleted', message: 'The note and its share link were removed.' });
    } catch (error) {
      notify({ type: 'error', title: 'Delete failed', message: errorMessage(error, 'Unable to delete note.') });
    }
  };

  const handleExtendNote = async (code) => {
    try {
      await notes.extendNote(code);
      await reloadNotes();
      notify({ type: 'success', title: 'Extended', message: `Note lifetime was extended by ${lifetimeLabel}.` });
    } catch (error) {
      notify({ type: 'error', title: 'Extend failed', message: errorMessage(error, 'Unable to extend note.') });
    }
  };

  const handleToggleNotePersistence = async (code, nextValue) => {
    try {
      await notes.toggleNotePersistence(code, nextValue);
      await reloadNotes();
      notify({
        type: 'success',
        title: nextValue ? 'Permanent mode enabled' : 'Expiry restored',
        message: nextValue
          ? 'This note will no longer expire.'
          : `This note now expires in ${lifetimeLabel}.`,
      });
    } catch (error) {
      notify({ type: 'error', title: 'Update failed', message: errorMessage(error, 'Unable to update note.') });
    }
  };

  const handleToggleNoteCollaboration = async (code, nextValue) => {
    try {
      await notes.setNoteCollaboration(code, nextValue);
      await reloadNotes();
      notify({
        type: 'success',
        title: nextValue ? 'Live editing on' : 'Live editing off',
        message: nextValue
          ? 'Anyone with the link can now edit this note together.'
          : 'The note is read-only again.',
      });
    } catch (error) {
      notify({ type: 'error', title: 'Update failed', message: errorMessage(error, 'Unable to update note.') });
    }
  };

  /* ------------------------------------------------- extend, unlock and PIN */

  const handleExtendManyWorkspaces = async (codes) => {
    try {
      await Promise.all(codes.map((code) => workspaces.extendWorkspace(code)));
      await reloadWorkspaces();
      notify({ type: 'success', title: 'Extended', message: `Extended ${codes.length} by ${lifetimeLabel}.` });
    } catch (error) {
      notify({ type: 'error', title: 'Extend failed', message: errorMessage(error, 'Unable to extend workspaces.') });
    }
  };

  const handleExtendManyNotes = async (codes) => {
    try {
      await Promise.all(codes.map((code) => notes.extendNote(code)));
      await reloadNotes();
      notify({ type: 'success', title: 'Extended', message: `Extended ${codes.length} by ${lifetimeLabel}.` });
    } catch (error) {
      notify({ type: 'error', title: 'Extend failed', message: errorMessage(error, 'Unable to extend notes.') });
    }
  };

  const handleUnlockWorkspace = async (code) => {
    try {
      if (await workspaces.unlockWorkspace(code)) await reloadWorkspaces();
    } catch (error) {
      notify({ type: 'error', title: 'Could not unlock', message: errorMessage(error, 'That PIN did not work.') });
    }
  };

  const handleUnlockNote = async (code) => {
    try {
      if (await notes.unlockNote(code)) await reloadNotes();
    } catch (error) {
      notify({ type: 'error', title: 'Could not unlock', message: errorMessage(error, 'That PIN did not work.') });
    }
  };

  /** Returns a PIN to set, or null to clear, or undefined if the person backed out. */
  const chooseNewPin = (hasPin, noun) => {
    if (hasPin) {
      return window.confirm(`Remove the PIN? Anyone with the code will be able to open this ${noun}.`) ? null : undefined;
    }
    const entered = window.prompt(`Choose a PIN (4 to 32 characters). Anyone opening this ${noun} will need it.`);
    return entered ? entered : undefined;
  };

  const handleSetWorkspacePin = async () => {
    if (!workspace) return;
    const pin = chooseNewPin(workspace.hasPin, 'workspace');
    if (pin === undefined) return;
    try {
      applyWorkspace(await workspaces.setWorkspacePin(workspace.code, pin), {
        type: 'success',
        title: pin ? 'PIN set' : 'PIN removed',
        message: pin ? 'People opening this workspace will be asked for it.' : 'The workspace opens with just its code again.',
      });
      await reloadWorkspaces();
    } catch (error) {
      notify({ type: 'error', title: 'Update failed', message: errorMessage(error, 'Unable to change the PIN.') });
    }
  };

  const handleSetNotePin = async (code, hasPin) => {
    const pin = chooseNewPin(hasPin, 'note');
    if (pin === undefined) return;
    try {
      await notes.setNotePin(code, pin);
      await reloadNotes();
      notify({
        type: 'success',
        title: pin ? 'PIN set' : 'PIN removed',
        message: pin ? 'People opening this note will be asked for it.' : 'The note opens with just its code again.',
      });
    } catch (error) {
      notify({ type: 'error', title: 'Update failed', message: errorMessage(error, 'Unable to change the PIN.') });
    }
  };

  /** Pulls somebody else's note into this browser's remembered list. */
  const handleOpenNoteCode = async (code) => {
    try {
      await notes.fetchNoteOrThrow(code);
      await reloadNotes();
      notify({ type: 'success', title: 'Note opened', message: 'It now appears in your notes list.' });
      return true;
    } catch (error) {
      notify({ type: 'error', title: 'Not found', message: errorMessage(error, 'That note is not available.') });
      return false;
    }
  };

  /* ------------------------------------------------------------------ render */

  if (route.name === 'note') {
    return (
      <NoteViewer
        code={route.code}
        onExit={() => {
          replacePath('/');
          setRoute({ name: 'app' });
          setTab('notes');
        }}
      />
    );
  }

  const shareUrlFor = (code) => new URL(`/w/${code}`, window.location.origin).toString();

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={async (event) => {
          const target = uploadTargetRef.current;
          uploadTargetRef.current = null;
          // Copy the FileList first: it is live, so clearing `value` empties it.
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          await handleUpload(files, target);
        }}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />

      <div className="nfs-shell nfs-shell--home">
        <header className="nfs-home-header">
          <div className="nfs-home-header__copy">
            <h1>NetFileShare</h1>
          </div>
          <nav className="nfs-tabs" aria-label="Sections">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nfs-tab${tab === item.id ? ' is-active' : ''}`}
                aria-current={tab === item.id ? 'page' : undefined}
                onClick={() => {
                  setTab(item.id);
                  if (item.id !== 'files') setIsWorkspaceView(false);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        {tab === 'files' ? (
          workspace && isWorkspaceView ? (
            <WorkspaceExplorer
              workspace={workspace}
              currentPath={currentPath}
              newFolderName={newFolderName}
              shareUrl={shareUrlFor(workspace.code)}
              uploadLimitLabel={uploadLimitLabel}
              lifetimeLabel={lifetimeLabel}
              onNewFolderNameChange={setNewFolderName}
              onCreateFolder={handleCreateFolder}
              onNavigate={setCurrentPath}
              onBack={handleBackToList}
              onExtend={() => handleExtendWorkspace(workspace.code)}
              onTogglePersistent={(next) => handleTogglePersistence(workspace.code, next)}
              onDeleteWorkspace={() => handleDeleteWorkspace(workspace.code)}
              onDownloadItem={(item) => workspaces.downloadItem(workspace.code, item)}
              onDeleteItem={handleDeleteItem}
              onRenameItem={handleRenameItem}
              dragActive={dragActive}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                if (event.currentTarget.contains(event.relatedTarget)) return;
                setDragActive(false);
              }}
              onDrop={async (event) => {
                event.preventDefault();
                setDragActive(false);
                await handleUpload(event.dataTransfer.files);
              }}
              onFilePicker={() => openFilePicker({ code: workspace.code, path: currentPath })}
              onSetPin={handleSetWorkspacePin}
              onToast={notify}
            />
          ) : (
            <WorkspaceHome
              joinCode={joinCode}
              onJoinCodeChange={setJoinCode}
              onCreate={handleCreateWorkspace}
              onJoin={handleJoinWorkspace}
              workspaces={workspaceList}
              isLoading={loadingWorkspaces}
              selectedWorkspace={workspace}
              shareUrlFor={shareUrlFor}
              onOpen={handleOpenWorkspace}
              onAddFiles={(code) => openFilePicker({ code, path: '/' })}
              onDeleteRecent={handleDeleteWorkspace}
              onRenameWorkspace={handleRenameWorkspace}
              onDownloadFile={(code, file) => workspaces.downloadItem(code, file)}
              onRemoveFile={handleRemoveFileFromHome}
              onExtendWorkspace={handleExtendWorkspace}
              onToggleWorkspacePersistent={handleTogglePersistence}
              onToast={notify}
              soonMs={soonMs}
              onExtendMany={handleExtendManyWorkspaces}
              onUnlock={handleUnlockWorkspace}
            />
          )
        ) : null}

        {tab === 'links' ? (
          <LinkManager
            links={linkList}
            isLoading={loadingLinks}
            onCreate={handleCreateLink}
            onUpdate={handleUpdateLink}
            onDelete={handleDeleteLink}
            onToast={notify}
          />
        ) : null}

        {tab === 'notes' ? (
          <NoteManager
            notes={noteList}
            isLoading={loadingNotes}
            maxBytes={limits?.maxNoteBytes ?? 0}
            onCreate={handleCreateNote}
            onUpdate={handleUpdateNote}
            onDelete={handleDeleteNote}
            onExtend={handleExtendNote}
            onTogglePersistent={handleToggleNotePersistence}
            onToggleCollaborative={handleToggleNoteCollaboration}
            onSetPin={handleSetNotePin}
            onUnlock={handleUnlockNote}
            onExtendMany={handleExtendManyNotes}
            soonMs={soonMs}
            onOpenCode={handleOpenNoteCode}
            onToast={notify}
          />
        ) : null}

        <BackupPanel
          onRestored={() => Promise.all([reloadWorkspaces(), reloadLinks(), reloadNotes()])}
          onToast={notify}
        />
      </div>
    </>
  );
}
