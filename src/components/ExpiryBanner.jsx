import { useState } from 'react';

/**
 * Items disappear for good when they expire, so say so before it happens and
 * offer the fix in one click. Renders nothing when nothing is close to expiring.
 */
export default function ExpiryBanner({ count, noun, onExtendAll }) {
  const [isBusy, setIsBusy] = useState(false);
  if (!count) return null;

  return (
    <div className="nfs-expiry-banner" role="status">
      <span>
        {count === 1 ? `1 ${noun} is` : `${count} ${noun}s are`} about to expire.
      </span>
      <button
        type="button"
        className="nfs-btn nfs-btn--primary nfs-btn--compact"
        disabled={isBusy}
        onClick={async () => {
          setIsBusy(true);
          try {
            await onExtendAll();
          } finally {
            setIsBusy(false);
          }
        }}
      >
        {isBusy ? 'Extending' : count === 1 ? 'Extend' : 'Extend all'}
      </button>
    </div>
  );
}
