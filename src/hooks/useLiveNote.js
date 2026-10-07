import { useCallback, useEffect, useRef, useState } from 'react';
import { applyPatch, makePatch, mapPosition, randomId } from '../lib/liveSync';
import { syncNote } from '../services/noteService';

/** Wait after the last keystroke before sending, so typing is batched. */
const SEND_DEBOUNCE_MS = 350;

const ACTIVE_POLL_MS = 1500;
const QUIET_POLL_MS = 5000;
const IDLE_POLL_MS = 12000;
const HIDDEN_POLL_MS = 15000;
const MAX_BACKOFF_MS = 30000;

/** Viewers only watch, so they poll more slowly than people typing. */
const VIEWER_SCALE = 2.5;

/**
 * Keeps one note in sync with the server and with other editors.
 *
 * Model: `base` is the last text the server confirmed. On each round trip the
 * hook sends only the diff from `base` to what the user has now, and the server
 * merges it into whatever the text has become. The reply is the merged text;
 * anything typed while the request was in flight is re-applied on top of it, and
 * the caret is carried across so remote edits do not make it jump.
 *
 * Polling cost matters on serverless hosting, where every call is an
 * invocation, so the interval backs off when nobody is typing and slows further
 * in a hidden tab. Any local or remote change snaps it back to fast.
 */
export function useLiveNote({ code, initial, readOnly, textareaRef }) {
  const [text, setTextState] = useState(initial.content ?? '');
  const [meta, setMeta] = useState({
    title: initial.title ?? '',
    format: initial.format,
    language: initial.language ?? null,
    size: initial.size ?? 0,
    updatedAt: initial.updatedAt,
  });
  const [status, setStatus] = useState('saved'); // saved | saving | offline | disabled | gone
  const [editors, setEditors] = useState(1);
  const [notice, setNotice] = useState(null);
  const [clientId] = useState(() => randomId(12));

  const textRef = useRef(text);
  const baseRef = useRef({ content: initial.content ?? '', rev: Number(initial.rev ?? 0) });
  const readOnlyRef = useRef(readOnly);
  const pendingSelection = useRef(null);
  const syncRef = useRef({ tick: () => {}, schedule: () => {} });
  const activityRef = useRef(0);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  /** Called by the editor on every user edit. */
  const setText = useCallback((value) => {
    textRef.current = value;
    activityRef.current = Date.now();
    setTextState(value);
    setStatus((current) => (current === 'offline' || current === 'disabled' || current === 'gone' ? current : 'saving'));
    syncRef.current.schedule(SEND_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    let stopped = false;
    let inflight = false;
    let timer = 0;
    let failures = 0;
    activityRef.current = Date.now();

    const nextDelay = () => {
      if (failures > 0) return Math.min(MAX_BACKOFF_MS, 4000 * 2 ** (failures - 1));
      const scale = readOnlyRef.current ? VIEWER_SCALE : 1;
      const idle = Date.now() - activityRef.current;
      let delay = ACTIVE_POLL_MS;
      if (idle > 120000) delay = IDLE_POLL_MS;
      else if (idle > 20000) delay = QUIET_POLL_MS;
      delay *= scale;
      if (document.hidden) delay = Math.max(delay, HIDDEN_POLL_MS);
      return delay;
    };

    const schedule = (delay) => {
      window.clearTimeout(timer);
      if (stopped) return;
      timer = window.setTimeout(tick, delay);
    };

    async function tick() {
      if (stopped) return;
      if (inflight) {
        schedule(300);
        return;
      }

      const sent = textRef.current;
      const base = baseRef.current;
      const patch = readOnlyRef.current ? '' : makePatch(base.content, sent);
      inflight = true;
      if (patch) setStatus('saving');

      try {
        const reply = await syncNote(code, {
          clientId,
          opId: randomId(8),
          rev: base.rev,
          patch,
          viewer: readOnlyRef.current,
        });
        if (stopped) return;
        failures = 0;

        if (reply.content !== undefined) {
          const latest = textRef.current;
          // Re-apply whatever was typed while the request was in flight.
          const next = latest === sent
            ? reply.content
            : applyPatch(makePatch(sent, latest), reply.content);

          if (reply.content !== base.content || reply.rev !== base.rev) activityRef.current = Date.now();
          baseRef.current = { content: reply.content, rev: reply.rev };

          if (next !== latest) {
            const field = textareaRef?.current;
            if (field && document.activeElement === field) {
              pendingSelection.current = [
                mapPosition(latest, next, field.selectionStart),
                mapPosition(latest, next, field.selectionEnd),
              ];
            }
            textRef.current = next;
            setTextState(next);
          }
        } else {
          baseRef.current = { ...base, rev: reply.rev };
        }

        if (reply.rejected > 0) setNotice({ type: 'rejected', text: sent });
        setEditors(Math.max(1, reply.editors ?? 1));
        const nextMeta = {
          title: reply.title,
          format: reply.format,
          language: reply.language,
          size: reply.size,
          updatedAt: reply.updatedAt,
        };
        // Keep the old object when nothing changed so polling does not re-render.
        setMeta((prev) => (Object.keys(nextMeta).every((key) => prev[key] === nextMeta[key]) ? prev : nextMeta));
        setStatus(textRef.current === baseRef.current.content ? 'saved' : 'saving');
      } catch (error) {
        if (stopped) return;
        const message = error instanceof Error ? error.message : '';
        if (/turned off/i.test(message)) {
          setStatus('disabled');
          stopped = true;
          return;
        }
        if (/not found|expired/i.test(message)) {
          setStatus('gone');
          stopped = true;
          return;
        }
        failures += 1;
        setStatus('offline');
      } finally {
        inflight = false;
      }

      if (!stopped) schedule(textRef.current !== baseRef.current.content ? SEND_DEBOUNCE_MS : nextDelay());
    }

    syncRef.current = { tick, schedule };
    schedule(SEND_DEBOUNCE_MS);

    const onVisible = () => {
      if (!document.hidden) schedule(0);
    };
    document.addEventListener('visibilitychange', onVisible);

    // Last chance to save unsent work when the tab is closed or navigated away.
    const onPageHide = () => {
      if (readOnlyRef.current) return;
      const patch = makePatch(baseRef.current.content, textRef.current);
      if (!patch) return;
      try {
        fetch(`/api/notes/${encodeURIComponent(code)}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, opId: randomId(8), rev: baseRef.current.rev, patch }),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // Nothing more can be done while the page is going away.
      }
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [code, clientId, textareaRef]);

  /** Returns the caret position to restore after a remote edit, once. */
  const consumeSelection = useCallback(() => {
    const target = pendingSelection.current;
    pendingSelection.current = null;
    return target;
  }, []);

  return {
    text,
    setText,
    meta,
    status,
    editors,
    notice,
    dismissNotice: () => setNotice(null),
    consumeSelection,
  };
}
