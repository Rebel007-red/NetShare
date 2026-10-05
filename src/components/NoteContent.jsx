import { useEffect, useMemo, useRef } from 'react';
import { highlightCodeBlocks, highlightToHtml } from '../lib/highlight';
import { renderMarkdown } from '../lib/markdown';

/**
 * Renders a note in its chosen format.
 *
 * `markdown` and `code` both inject HTML, which is safe only because the
 * markdown path runs through DOMPurify and the code path through highlight.js,
 * which escapes everything it emits.
 */
export default function NoteContent({ note, view = 'rendered' }) {
  const containerRef = useRef(null);
  const content = note?.content ?? '';
  const format = note?.format ?? 'text';
  const showRaw = view === 'raw' || format === 'text';

  const html = useMemo(() => {
    if (showRaw) return '';
    if (format === 'code') return highlightToHtml(content, note?.language);
    return renderMarkdown(content);
  }, [content, format, note?.language, showRaw]);

  useEffect(() => {
    if (showRaw || format !== 'markdown') return;
    highlightCodeBlocks(containerRef.current);
  }, [html, showRaw, format]);

  if (showRaw) {
    return (
      <pre className="nfs-note-content nfs-note-content--raw">
        <code>{content}</code>
      </pre>
    );
  }

  if (format === 'code') {
    return (
      <pre className="nfs-note-content nfs-note-content--code">
        {/* eslint-disable-next-line react/no-danger */}
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="nfs-note-content nfs-note-content--markdown"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
