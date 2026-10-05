import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const marked = new Marked({
  gfm: true,
  breaks: true,
});

const SAFE_PROTOCOLS = /^(?:https?:|mailto:|#|\/|\.{1,2}\/)/i;

let hooksInstalled = false;

/**
 * Notes are authored by anyone holding a share code and rendered for everyone
 * else, so the markdown output is sanitized before it reaches the DOM. Links
 * are additionally restricted to safe protocols and opened without a referrer.
 */
function installHooks() {
  if (hooksInstalled) return;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (!SAFE_PROTOCOLS.test(href)) {
        node.removeAttribute('href');
      } else if (/^https?:/i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      if (!/^(?:https?:|data:image\/|\/)/i.test(src)) node.removeAttribute('src');
      node.setAttribute('loading', 'lazy');
    }
  });

  hooksInstalled = true;
}

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'img', 'input', 'li', 'ol', 'p', 'pre', 'strong', 'sub', 'sup',
    'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
  ],
  ALLOWED_ATTR: ['alt', 'checked', 'class', 'disabled', 'href', 'src', 'title', 'type'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta'],
  FORBID_ATTR: ['style', 'srcset', 'onerror', 'onload'],
};

export function renderMarkdown(source) {
  installHooks();
  try {
    const html = marked.parse(String(source ?? ''));
    return DOMPurify.sanitize(html, PURIFY_CONFIG);
  } catch {
    return '<p>This note could not be rendered. Use the raw view instead.</p>';
  }
}
