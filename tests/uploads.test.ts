import { describe, it, expect } from 'vitest';
import {
  ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, UPLOAD_PREFIXES,
  checkUpload, checkImageUrl, isUploadPrefix, formatBytes,
} from '@/lib/uploads/constraints';
import { imageSchema } from '@/lib/validations/products';
import { parseBlockData } from '@/lib/cms/blocks';

const JPEG = 'image/jpeg';

describe('what may be uploaded', () => {
  it('accepts the four formats the storefront can render', () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      expect(checkUpload({ type, size: 1024 }).ok).toBe(true);
    }
  });

  it('refuses anything else, including things that look like images', () => {
    for (const type of ['image/svg+xml', 'image/gif', 'application/pdf', 'text/html', '']) {
      expect(checkUpload({ type, size: 1024 }).ok).toBe(false);
    }
  });

  it('refuses SVG specifically', () => {
    // An SVG is a document that can carry script. Served from the same bucket
    // as the product photos, it would be a stored XSS with a .svg extension.
    expect(checkUpload({ type: 'image/svg+xml', size: 10 }).ok).toBe(false);
  });

  it('refuses a file over the limit and says how big it was allowed to be', () => {
    const res = checkUpload({ type: JPEG, size: MAX_UPLOAD_BYTES + 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/8 MB/);
  });

  it('accepts a file exactly on the limit', () => {
    expect(checkUpload({ type: JPEG, size: MAX_UPLOAD_BYTES }).ok).toBe(true);
  });

  it('refuses an empty file', () => {
    expect(checkUpload({ type: JPEG, size: 0 }).ok).toBe(false);
    expect(checkUpload({ type: JPEG, size: Number.NaN }).ok).toBe(false);
  });
});

describe('where an upload may land', () => {
  it('accepts only the folders the admin actually uses', () => {
    for (const prefix of UPLOAD_PREFIXES) expect(isUploadPrefix(prefix)).toBe(true);
  });

  it('refuses a path that would climb out of its folder', () => {
    // The prefix is interpolated into the object key, so an open-ended value
    // lets whoever calls the presign endpoint choose where the file is written.
    expect(isUploadPrefix('../../secrets')).toBe(false);
    expect(isUploadPrefix('/products')).toBe(false);
    expect(isUploadPrefix('products/../brand')).toBe(false);
    expect(isUploadPrefix('')).toBe(false);
    expect(isUploadPrefix(undefined)).toBe(false);
  });
});

describe('a pasted image address', () => {
  it('accepts an https address', () => {
    expect(checkImageUrl('https://cdn.example/img.jpg').ok).toBe(true);
  });

  it('accepts a path inside the site', () => {
    // `/og-default.jpg` lives in public/ and is a legitimate stored value.
    expect(checkImageUrl('/og-default.jpg').ok).toBe(true);
  });

  it('accepts empty, which means "no image"', () => {
    expect(checkImageUrl('').ok).toBe(true);
    expect(checkImageUrl('   ').ok).toBe(true);
  });

  it('refuses a scheme that can execute', () => {
    // This value ends up in a `src` attribute.
    expect(checkImageUrl('javascript:alert(1)').ok).toBe(false);
    expect(checkImageUrl('data:text/html,<script>alert(1)</script>').ok).toBe(false);
    expect(checkImageUrl('vbscript:msgbox(1)').ok).toBe(false);
  });

  it('refuses a protocol-relative address, which is not a path', () => {
    expect(checkImageUrl('//evil.example/x.jpg').ok).toBe(false);
  });

  it('refuses something that is not an address at all', () => {
    expect(checkImageUrl('just some words').ok).toBe(false);
  });
});

describe('product images carry a description', () => {
  const base = { productId: 'p1', url: 'https://cdn.example/x.jpg', device: 'ALL', type: 'IMAGE' };

  it('refuses an image with no alt text', () => {
    // The old upload path filled this with the file name. "IMG_4823.jpg" is
    // worse than blank, because it looks like the field was filled in.
    const res = imageSchema.safeParse({ ...base, alt: '' });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toMatch(/Alt text is required/);
  });

  it('refuses whitespace as alt text', () => {
    expect(imageSchema.safeParse({ ...base, alt: '   ' }).success).toBe(false);
  });

  it('accepts a described image', () => {
    expect(imageSchema.safeParse({ ...base, alt: '22k gold jhumka with pearl drop' }).success).toBe(true);
  });

  it('refuses an executable address in the image field', () => {
    expect(imageSchema.safeParse({ ...base, url: 'javascript:alert(1)', alt: 'x' }).success).toBe(false);
  });
});

describe('CMS image fields get the same treatment', () => {
  it('refuses an executable address in a hero image', () => {
    const res = parseBlockData('HERO', { heading: 'Hi', imageUrl: 'javascript:alert(1)' });
    expect(res.success).toBe(false);
  });

  it('keeps the mobile image, which had no editor field before', () => {
    const res = parseBlockData('HERO', {
      heading: 'Hi', imageUrl: '/a.jpg', mobileImageUrl: '/a-mobile.jpg', imageAlt: 'A gold necklace',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      const data = res.data as { mobileImageUrl: string; imageAlt: string };
      expect(data.mobileImageUrl).toBe('/a-mobile.jpg');
      expect(data.imageAlt).toBe('A gold necklace');
    }
  });

  it('leaves a block with no image valid', () => {
    expect(parseBlockData('HERO', { heading: 'Hi' }).success).toBe(true);
  });
});

describe('sizes read the way an operator expects', () => {
  it('reports MB, KB and bytes', () => {
    expect(formatBytes(9 * 1024 * 1024)).toBe('9.0 MB');
    expect(formatBytes(200 * 1024)).toBe('200 KB');
    expect(formatBytes(512)).toBe('512 B');
  });
});
