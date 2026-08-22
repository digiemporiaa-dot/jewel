import { parseCertifications, purityMarkLabel, ISSUERS } from '@/lib/products/certification';
import { cn } from '@/lib/utils/cn';

/**
 * Hallmark and certificate, shown where a shopper is deciding.
 *
 * The data has been in `Product.certification` since the catalogue was built and
 * appeared as one grey row at the bottom of the spec table. In jewellery this is
 * not decoration: a 22K chain with no visible hallmark is a chain somebody has
 * to take on trust, and a diamond with a report number they can check is a
 * different purchase from one without.
 *
 * Nothing here is asserted on the shop's behalf. A number is only linked when
 * the issuer publishes a page that checks it, and a string this does not
 * recognise is printed as the jeweller typed it rather than dressed up as a
 * certificate.
 */
export default function TrustSignals({
  values, className,
}: {
  /** Every certification string on the product — its own, and its stones'. */
  values: (string | null | undefined)[];
  className?: string;
}) {
  const certificates = parseCertifications(values);
  if (certificates.length === 0) return null;

  return (
    <section className={cn('border border-line', className)} aria-label="Certification">
      <ul className="divide-y divide-line/60">
        {certificates.map((c) => {
          const purity = purityMarkLabel(c.purityMark);
          return (
            <li key={c.raw} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
              <span className="flex items-center gap-2">
                <CertificateMark />
                <span className="text-sm font-medium">{c.label}</span>
              </span>

              {purity && <span className="text-sm text-ink-soft">{purity}</span>}

              {c.number && (
                <span className="font-mono text-xs tracking-wide text-ink-soft">{c.number}</span>
              )}

              {c.verifyUrl ? (
                <a
                  href={c.verifyUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ml-auto text-xs underline decoration-line-strong underline-offset-4 hover:text-brass"
                >
                  Verify with {c.issuer ? ISSUERS[c.issuer].full : 'the issuer'}
                </a>
              ) : c.note ? (
                // BIS has no per-HUID web lookup — the number is checked in the
                // BIS Care app. Saying that is more use than a link to a homepage.
                <span className="ml-auto text-xs text-ink-soft">{c.note}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CertificateMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brass">
      <circle cx="12" cy="9" r="5.25" />
      <path d="M8.5 13.5 7 21l5-2.5L17 21l-1.5-7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
