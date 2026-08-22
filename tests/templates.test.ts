import { describe, it, expect } from 'vitest';
import {
  renderTemplate, sanitizeTemplateHtml, wouldStripMarkup, escapeHtml,
  extractVariables, unknownVariables, stripTags,
  type TemplateVariable,
} from '@/lib/templates/render';
import { TEMPLATES, templateDefinition, sampleValues, isTemplateKey } from '@/lib/templates/registry';

const VARS: TemplateVariable[] = [
  { name: 'name', description: 'Customer name', sample: 'Ananya' },
  { name: 'brand', description: 'Shop name', sample: 'Maya Jewellers' },
  { name: 'items_table', description: 'Order lines', sample: '<tr><td>x</td></tr>', html: true },
];

describe('substitution', () => {
  it('replaces a whitelisted placeholder with its value', () => {
    expect(renderTemplate('Hi {{name}}', { name: 'Ananya' }, VARS)).toBe('Hi Ananya');
  });

  it('tolerates spaces inside the braces', () => {
    expect(renderTemplate('Hi {{ name }}', { name: 'Ananya' }, VARS)).toBe('Hi Ananya');
  });

  it('drops a placeholder that is not on the whitelist', () => {
    // The whitelist is the only thing deciding what customer data can reach a
    // template, so an unlisted name must resolve to nothing — not to a lookup.
    expect(renderTemplate('{{gstin}}!', { gstin: '07AAA…' }, VARS)).toBe('!');
  });

  it('drops a whitelisted placeholder with no value supplied', () => {
    expect(renderTemplate('Hi {{name}}.', {}, VARS)).toBe('Hi .');
  });

  it('replaces every occurrence, not just the first', () => {
    expect(renderTemplate('{{name}} {{name}}', { name: 'A' }, VARS)).toBe('A A');
  });

  it('leaves malformed braces alone', () => {
    expect(renderTemplate('{{ name', { name: 'A' }, VARS)).toBe('{{ name');
    expect(renderTemplate('{name}', { name: 'A' }, VARS)).toBe('{name}');
  });
});

describe('substitution never executes anything', () => {
  it('treats an expression as a plain unknown name', () => {
    // There is no expression language. `{{1+1}}` is not a variable name, so the
    // regex does not even match it, and it renders literally.
    expect(renderTemplate('{{1+1}}', {}, VARS)).toBe('{{1+1}}');
  });

  it('does not resolve inherited object properties as variables', () => {
    // A naive `values[key]` lookup would happily return Object.prototype
    // members; the whitelist check runs first, so these are never reached.
    expect(renderTemplate('{{constructor}}', {}, VARS)).toBe('');
    expect(renderTemplate('{{__proto__}}', {}, VARS)).toBe('');
    expect(renderTemplate('{{toString}}', {}, VARS)).toBe('');
  });

  it('does not re-scan a substituted value for further placeholders', () => {
    // Otherwise a customer could name themselves "{{items_table}}" and pull in
    // a value the template never referenced.
    const out = renderTemplate('{{name}}', { name: '{{brand}}', brand: 'Secret' }, VARS);
    expect(out).not.toContain('Secret');
    expect(out).toBe('{{brand}}');
  });
});

describe('escaping of substituted values', () => {
  it('escapes a customer-supplied value into HTML', () => {
    const out = renderTemplate('<p>{{name}}</p>', { name: '<img src=x onerror=alert(1)>' }, VARS);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes quotes, so a value cannot break out of an attribute', () => {
    expect(escapeHtml(`" onmouseover="x`)).toBe('&quot; onmouseover=&quot;x');
  });

  it('passes through only values the registry marks as html', () => {
    const out = renderTemplate('{{items_table}}', { items_table: '<tr><td>Ring</td></tr>' }, VARS);
    expect(out).toBe('<tr><td>Ring</td></tr>');
  });

  it('strips tags out of an html value when rendering plain text', () => {
    const out = renderTemplate('{{items_table}}', { items_table: '<tr><td>Ring</td></tr>' }, VARS, 'text');
    expect(out).toBe('Ring');
  });

  it('does not escape in text mode — a subject line is not markup', () => {
    expect(renderTemplate('{{name}}', { name: 'Ram & Co' }, VARS, 'text')).toBe('Ram & Co');
  });
});

describe('reading variables out of a body', () => {
  it('lists each distinct placeholder once, in order', () => {
    expect(extractVariables('{{brand}} {{name}} {{brand}}')).toEqual(['brand', 'name']);
  });

  it('reports the ones the template is not allowed to use', () => {
    expect(unknownVariables('{{name}} {{card_number}}', VARS)).toEqual(['card_number']);
    expect(unknownVariables('{{name}}', VARS)).toEqual([]);
  });
});

describe('sanitising a template body', () => {
  it('removes a script tag and its contents', () => {
    const out = sanitizeTemplateHtml('<p>Hi</p><script>fetch("//evil")</script>');
    expect(out).toBe('<p>Hi</p>');
    expect(out).not.toContain('evil');
  });

  it('removes inline event handlers', () => {
    const out = sanitizeTemplateHtml('<p onclick="steal()">Hi</p>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('Hi');
  });

  it('removes a javascript: link but keeps the text', () => {
    const out = sanitizeTemplateHtml('<a href="javascript:alert(1)">Click</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('Click');
  });

  it('removes data: and vbscript: URLs', () => {
    expect(sanitizeTemplateHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">')).not.toContain('data:');
    expect(sanitizeTemplateHtml('<a href="vbscript:msgbox">x</a>')).not.toContain('vbscript:');
  });

  it('removes an iframe — the same rule as video embeds and marketing tags', () => {
    expect(sanitizeTemplateHtml('<iframe src="https://evil.example"></iframe>')).toBe('');
  });

  it('removes a style block, which can be used to overlay a fake form', () => {
    expect(sanitizeTemplateHtml('<style>body{display:none}</style><p>Hi</p>')).toBe('<p>Hi</p>');
  });

  it('keeps the formatting an email actually needs', () => {
    const html = '<h2>Title</h2><p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>';
    expect(sanitizeTemplateHtml(html)).toBe(html);
  });

  it('keeps https links and images', () => {
    const html = '<a href="https://shop.example/cart">Bag</a><img src="https://shop.example/a.jpg" alt="A" />';
    const out = sanitizeTemplateHtml(html);
    expect(out).toContain('https://shop.example/cart');
    expect(out).toContain('https://shop.example/a.jpg');
  });

  it('keeps mailto and tel links, which a shop email needs', () => {
    expect(sanitizeTemplateHtml('<a href="mailto:a@b.co">Mail</a>')).toContain('mailto:');
    expect(sanitizeTemplateHtml('<a href="tel:+919810000000">Call</a>')).toContain('tel:');
  });

  it('keeps safe inline styles but drops a scripted one', () => {
    expect(sanitizeTemplateHtml('<p style="color:#17362C">Hi</p>')).toContain('color:#17362C');
    expect(sanitizeTemplateHtml('<p style="background:url(javascript:alert(1))">Hi</p>')).not.toContain('javascript');
  });

  it('adds noopener to a link that opens a new window', () => {
    const out = sanitizeTemplateHtml('<a href="https://x.example" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('is idempotent — sanitising clean output changes nothing', () => {
    const once = sanitizeTemplateHtml('<p onclick="x">Hi <script>y</script></p>');
    expect(sanitizeTemplateHtml(once)).toBe(once);
  });

  it('reports whether anything would be stripped, for the save-time warning', () => {
    expect(wouldStripMarkup('<p>Hi</p>')).toBe(false);
    expect(wouldStripMarkup('<p onclick="x">Hi</p>')).toBe(true);
  });

  it('strips everything for the plain-text alternative', () => {
    expect(stripTags('<p>Hi <strong>there</strong></p>')).toBe('Hi there');
  });
});

describe('the template catalogue', () => {
  it('covers every key the code sends', () => {
    const keys = TEMPLATES.map((t) => t.key);
    for (const k of [
      'order_confirmation', 'payment_confirmation', 'abandoned_cart',
      'birthday', 'anniversary', 'appointment_confirmation',
    ]) {
      expect(keys).toContain(k);
    }
  });

  it('ships working copy for every key', () => {
    for (const t of TEMPLATES) {
      expect(t.defaultSubject.trim().length).toBeGreaterThan(0);
      expect(t.defaultBodyHtml.trim().length).toBeGreaterThan(0);
    }
  });

  it('only references variables it declares', () => {
    // A default body naming a variable that is not on its own whitelist would
    // render as a silent gap in a real customer email.
    for (const t of TEMPLATES) {
      expect(unknownVariables(t.defaultBodyHtml, t.variables)).toEqual([]);
      expect(unknownVariables(t.defaultSubject, t.variables)).toEqual([]);
    }
  });

  it('has default copy that survives its own sanitiser untouched', () => {
    for (const t of TEMPLATES) {
      expect(wouldStripMarkup(t.defaultBodyHtml)).toBe(false);
    }
  });

  it('marks only server-built values as html', () => {
    // Anything a customer or operator can influence must be escaped.
    const htmlVars = TEMPLATES.flatMap((t) => t.variables.filter((v) => v.html).map((v) => v.name));
    expect([...new Set(htmlVars)]).toEqual(['items_table']);
  });

  it('gives every variable a sample, so the preview is never blank', () => {
    for (const t of TEMPLATES) {
      for (const v of t.variables) expect(v.sample.length).toBeGreaterThan(0);
    }
  });

  it('renders every default body with its samples and leaves no placeholders', () => {
    for (const t of TEMPLATES) {
      const out = renderTemplate(t.defaultBodyHtml, sampleValues(t), t.variables);
      expect(out).not.toMatch(/\{\{/);
    }
  });

  it('uses unique keys', () => {
    const keys = TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('recognises its own keys and rejects others', () => {
    expect(isTemplateKey('birthday')).toBe(true);
    expect(isTemplateKey('not_a_template')).toBe(false);
    expect(templateDefinition('not_a_template')).toBeNull();
  });
});

describe('the plain-text alternative', () => {
  it('does not run table cells together', () => {
    // Otherwise a two-cell row arrives as "Necklace × 1₹1,24,300.00".
    const out = stripTags('<tr><td>Necklace × 1</td><td>₹1,24,300.00</td></tr>');
    expect(out).toBe('Necklace × 1 ₹1,24,300.00');
  });

  it('separates paragraphs and list items with line breaks', () => {
    expect(stripTags('<p>One</p><p>Two</p>')).toBe('One\nTwo');
    expect(stripTags('<ul><li>A</li><li>B</li></ul>')).toBe('A\nB');
  });

  it('decodes the entities it produced, so & reads as &', () => {
    // A shop called "Ram & Co" must not arrive as "Ram &amp; Co".
    expect(stripTags('<p>Ram &amp; Co</p>')).toBe('Ram & Co');
    expect(stripTags('<p>3&quot; drop</p>')).toBe('3" drop');
  });

  it('does not decode its way back into markup', () => {
    // Escaping "<script>" produces "&lt;script&gt;"; decoding must not
    // reconstitute a tag from text that had already been neutralised.
    const once = stripTags('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(once).toBe('<script>alert(1)</script>');
    // …and the result is plain text, so re-stripping is where a real tag would
    // be removed. The point is that no *new* markup was created by decoding.
    expect(stripTags('<p>&amp;lt;b&amp;gt;</p>')).toBe('&lt;b&gt;');
  });

  it('collapses runaway whitespace from source formatting', () => {
    expect(stripTags('<p>One</p>\n\n\n\n<p>Two</p>')).toBe('One\nTwo');
  });
});
