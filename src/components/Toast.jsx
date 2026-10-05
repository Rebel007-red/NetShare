export default function Toast({ toast, onClose }) {
  if (!toast) return null;

  return (
    <div className="nfs-toast-region" role="status" aria-live="polite">
      <div className={`nfs-toast nfs-toast--${toast.type ?? 'info'}`}>
        <div className="nfs-toast__copy">
          <span className="nfs-toast__label">{toast.title ?? 'Notice'}</span>
          {toast.message ? <span className="nfs-toast__message">{toast.message}</span> : null}
        </div>
        <button type="button" className="nfs-toast__close" onClick={onClose} aria-label="Dismiss notification">
          &times;
        </button>
      </div>
    </div>
  );
}
