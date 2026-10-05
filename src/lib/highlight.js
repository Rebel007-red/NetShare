import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * highlight.js core plus an explicit language list, rather than the full build.
 * The full bundle is close to a megabyte and would dominate the app's payload.
 * `xml` covers HTML, so both names map to it.
 */
const LANGUAGES = {
  bash,
  css,
  diff,
  dockerfile,
  go,
  html: xml,
  ini,
  java,
  javascript,
  json,
  markdown,
  plaintext,
  powershell,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

let registered = false;

function ensureRegistered() {
  if (registered) return;
  for (const [name, definition] of Object.entries(LANGUAGES)) {
    hljs.registerLanguage(name, definition);
  }
  hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' });
  hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
  hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
  hljs.registerAliases(['yml'], { languageName: 'yaml' });
  hljs.registerAliases(['ps1', 'pwsh'], { languageName: 'powershell' });
  hljs.registerAliases(['py'], { languageName: 'python' });
  hljs.registerAliases(['md'], { languageName: 'markdown' });
  hljs.configure({ ignoreUnescapedHTML: true, throwUnescapedHTML: false });
  registered = true;
}

export function isSupportedLanguage(language) {
  ensureRegistered();
  return Boolean(hljs.getLanguage(String(language ?? '')));
}

/**
 * Returns highlighted HTML for `code`. hljs escapes the input it emits, so the
 * result is safe to inject; on any failure the caller gets escaped plain text.
 */
export function highlightToHtml(code, language) {
  ensureRegistered();
  const source = String(code ?? '');
  const name = String(language ?? '').trim();

  if (name && name !== 'plaintext' && hljs.getLanguage(name)) {
    try {
      return hljs.highlight(source, { language: name, ignoreIllegals: true }).value;
    } catch {
      // Fall through to escaped text.
    }
  }
  return escapeHtml(source);
}

/** Highlights every fenced block inside already-sanitized markdown output. */
export function highlightCodeBlocks(container) {
  ensureRegistered();
  if (!container) return;

  for (const block of container.querySelectorAll('pre > code')) {
    const className = block.getAttribute('class') ?? '';
    const match = /(?:^|\s)language-([\w+-]+)/.exec(className);
    const language = match?.[1];
    // Only highlight languages we bundled; anything else stays as plain text.
    if (!language || !hljs.getLanguage(language)) continue;
    block.innerHTML = highlightToHtml(block.textContent, language);
    block.classList.add('hljs');
  }
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}
