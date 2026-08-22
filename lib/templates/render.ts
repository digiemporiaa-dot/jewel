/**
 * Template rendering and HTML sanitisation.
 *
 * Two rules shape everything in this file.
 *
 * 1. **Substitution is plain string replacement against a fixed whitelist.**
 *    There is no expression language, no `eval`, no `new Function`, and no
 *    template engine that could be talked into evaluating one. A template body
 *    is operator-supplied text; the moment it can execute, an admin account
 *    becomes a code-execution account.
 *
 * 2. **Values are HTML-escaped unless the registry says otherwise.** A customer
 *    called `<img onerror=…>` must not become markup in an email, and must not
 *    become markup in the admin preview either — the preview renders in a real
 *    browser. Only variables the *server* builds (an order line table, say) are
 *    marked as HTML in the registry and pass through unescaped.
 *
 * Pure and dependency-free apart from sanitize-html, so it is unit-testable
 * without a database.
 */

import sanitizeHtml from 'sanitize-html';

/** A variable a template may reference. */
export type TemplateVariable = {
  name: string;
  /** Shown in the admin editor so the operator knows what it produces. */
  description: string;
  /** Value used for the preview and the test send. */
  sample: string;
  /**
   * True only for values this codebase constructs itself (e.g. an order line
   * table). Operator- and customer-supplied values are never html.
   */
  html?: boolean;
};

/** `{{ variable_name }}` — word characters only, optional surrounding spaces. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Every distinct `{{placeholder}}` a piece of text refers to, in order. */
export function extractVariables(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const name = m[1];
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

/** Placeholders that are not on the template's whitelist. */
export function unknownVariables(text: string, allowed: TemplateVariable[]): string[] {
  const names = new Set(allowed.map((v) => v.name));
  return extractVariables(text).filter((n) => !names.has(n));
}

export type RenderMode = 'html' | 'text';

/**
 * Substitute `{{name}}` for its value.
 *
 * A placeholder that is not on the whitelist, or that has no value supplied,
 * resolves to the empty string. Leaving `{{customer_name}}` visible in a
 * customer's inbox looks broken in a way that reads as "this shop is not real";
 * an empty gap reads as a typo. The admin editor refuses to save an unknown
 * placeholder in the first place, so this path is the defensive one.
 */
export function renderTemplate(
  text: string,
  values: Record<string, string>,
  allowed: TemplateVariable[],
  mode: RenderMode = 'html'
): string {
  const byName = new Map(allowed.map((v) => [v.name, v]));

  return text.replace(PLACEHOLDER, (_match, rawName: string) => {
    const variable = byName.get(rawName);
    if (!variable) return '';

    const value = values[rawName];
    if (value === undefined || value === null) return '';

    // Plain text has no markup to escape into, and must never carry HTML
    // through — a subject line containing tags is a rendering bug, not a
    // feature.
    if (mode === 'text') return variable.html ? stripTags(value) : value;

    return variable.html ? value : escapeHtml(value);
  });
}

/** Tags that end a visual block, so text either side must not run together. */
const BLOCK_BOUNDARY = /<(\/?)\s*(br|p|div|tr|td|th|li|h[1-6]|table|thead|tbody|tfoot|ul|ol|blockquote)\b[^>]*>/gi;

/**
 * What a block tag becomes in plain text.
 *
 * Closing a row, paragraph or list item starts a new line; closing a *cell*
 * only needs a space, so `Necklace × 1` and its price stay on one line the way
 * they look in the table. Opening tags contribute a space, which the whitespace
 * collapse below absorbs.
 */
function blockSeparator(closing: boolean, tag: string): string {
  if (tag === 'br') return '\n';
  if (!closing) return ' ';
  return tag === 'td' || tag === 'th' ? ' ' : '\n';
}

/**
 * Drop all tags, for the plain-text alternative and for subject lines.
 *
 * Two details matter for a body a person will actually read. Block boundaries
 * become whitespace, so a two-cell table row does not come out as
 * `Necklace × 1₹1,24,300.00`. And the entities the stripper produces are decoded
 * back to characters, so a shop called `Ram & Co` reads as itself rather than as
 * `Ram &amp; Co`.
 */
export function stripTags(html: string): string {
  const spaced = html.replace(BLOCK_BOUNDARY, (_m, slash: string, tag: string) =>
    blockSeparator(slash === '/', tag.toLowerCase())
  );
  const stripped = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} });
  return decodeEntities(stripped)
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .trim();
}

/**
 * Reverse the escaping the stripper applies.
 *
 * Only the five entities `escapeHtml` and sanitize-html produce — this is not a
 * general HTML entity decoder, and deliberately so: it runs on output that is
 * about to be treated as plain text, where a broader decoder would be a way to
 * reintroduce markup that the stripper had already removed.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&'); // last, so &amp;lt; decodes to &lt; and no further
}

/**
 * What an operator may write in a template body.
 *
 * Formatting, links, images and simple tables — the vocabulary of an HTML
 * email. No `<script>`, no `<style>`, no event handlers, no `javascript:` or
 * `data:` URLs, no iframes or objects. This is the same principle as the
 * marketing-tag work: the admin describes what it wants, the code builds the
 * markup, and operator text never becomes executable.
 */
/** One to four lengths, or a bare `0` — `12px`, `0 auto`, `4px 0 8px 2px`. */
const BOX = /^(0|\d+(\.\d+)?(px|pt|em|rem|%))(\s+(0|\d+(\.\d+)?(px|pt|em|rem|%))){0,3}$/;
/** `1px solid #E4DED4`, `none`. No `url(…)`, so no scheme can hide in a border. */
const BORDER = /^(none|\d+(\.\d+)?(px|pt|em|rem)\s+(solid|dashed|dotted|double)\s+(#[0-9a-fA-F]{3,8}|[a-zA-Z]+))$/;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'div', 'span', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'small',
    'ul', 'ol', 'li',
    'a', 'img',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['align', 'valign', 'colspan', 'rowspan'],
    th: ['align', 'valign', 'colspan', 'rowspan'],
    table: ['width', 'border', 'cellpadding', 'cellspacing'],
    // Inline style is how HTML email is written — there is no stylesheet to
    // link to. sanitize-html parses each declaration and drops anything not
    // matched below, so `background:url(javascript:…)` cannot survive.
    '*': ['style'],
  },
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s.,%]+\)$/, /^[a-zA-Z]+$/],
      'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s.,%]+\)$/, /^[a-zA-Z]+$/],
      'font-family': [/^[\w\s",'-]+$/],
      'font-size': [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
      'font-weight': [/^(normal|bold|lighter|bolder|[1-9]00)$/],
      'font-style': [/^(normal|italic)$/],
      'text-align': [/^(left|right|center|justify)$/],
      'text-decoration': [/^(none|underline|line-through)$/],
      'line-height': [/^\d+(\.\d+)?(px|pt|em|rem|%)?$/],
      margin: [BOX, /^auto$/],
      'margin-top': [BOX],
      'margin-right': [BOX],
      'margin-bottom': [BOX],
      'margin-left': [BOX],
      padding: [BOX],
      'padding-top': [BOX],
      'padding-right': [BOX],
      'padding-bottom': [BOX],
      'padding-left': [BOX],
      'max-width': [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
      width: [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
      border: [BORDER],
      'border-top': [BORDER],
      'border-right': [BORDER],
      'border-bottom': [BORDER],
      'border-left': [BORDER],
      'border-collapse': [/^(collapse|separate)$/],
    },
  },
  // Anything else — javascript:, data:, vbscript: — is dropped with the
  // attribute, so a link cannot smuggle a scheme past the allowlist.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  // Drop the *contents* of a stripped script or style block too. The default
  // keeps inner text, which would dump raw JavaScript source into the email
  // body as visible text.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  transformTags: {
    // An external link opened from a mail client should not be able to reach
    // back through window.opener.
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target === '_blank'
        ? { ...attribs, rel: 'noopener noreferrer' }
        : attribs,
    }),
  },
};

/**
 * Clean a template body for storage.
 *
 * Called on save, not on send: the database holds only safe markup, so a
 * sanitiser change can never retroactively expose something already stored, and
 * the send path stays cheap.
 */
export function sanitizeTemplateHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** True when sanitising would change the input — used to warn on save. */
export function wouldStripMarkup(html: string): boolean {
  return sanitizeTemplateHtml(html) !== html;
}
