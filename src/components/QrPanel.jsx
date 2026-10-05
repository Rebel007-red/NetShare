import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

const SIZE = 180;

/**
 * Renders a QR code for a share URL and offers it as a PNG download.
 * A canvas (rather than SVG) is used precisely so toDataURL can export it.
 */
export default function QrPanel({ value, filename = 'qr-code', caption }) {
  const wrapperRef = useRef(null);
  const [error, setError] = useState('');

  if (!value) return null;

  const handleDownload = () => {
    const canvas = wrapperRef.current?.querySelector('canvas');
    if (!canvas) {
      setError('The QR code is not ready yet.');
      return;
    }
    try {
      const anchor = document.createElement('a');
      anchor.href = canvas.toDataURL('image/png');
      anchor.download = `${filename}.png`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setError('');
    } catch {
      setError('This browser blocked the QR download.');
    }
  };

  return (
    <div className="nfs-qr" ref={wrapperRef}>
      <div className="nfs-qr__frame">
        <QRCodeCanvas
          value={value}
          size={SIZE}
          marginSize={2}
          level="M"
          bgColor="#ffffff"
          fgColor="#0b4d4f"
        />
      </div>
      <div className="nfs-qr__meta">
        {caption ? <span className="nfs-qr__caption">{caption}</span> : null}
        <button type="button" className="nfs-btn nfs-btn--ghost nfs-btn--compact" onClick={handleDownload}>
          Save PNG
        </button>
        {error ? <span className="nfs-qr__error">{error}</span> : null}
      </div>
    </div>
  );
}
