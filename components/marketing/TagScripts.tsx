'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import type { PublicTagConfig } from '@/lib/marketing/tags';
import { readConsentCookie, mayLoadTags, type ConsentChoice } from '@/lib/marketing/consent';
import { CONSENT_COOKIE } from '@/lib/marketing/consent';

/**
 * Loads the configured marketing tags.
 *
 * Every script here is **generated from a validated ID** — there is no path by
 * which operator-supplied markup reaches the page. The IDs have already passed a
 * strict pattern on save and are re-checked on read, so the interpolations below
 * cannot carry anything but the shape they were validated against.
 *
 * Two rules shape what actually loads:
 *
 *  - **`afterInteractive`, never `beforeInteractive`.** This is a jewellery
 *    storefront where large images already dominate LCP; analytics must not
 *    compete with first paint.
 *  - **GTM supersedes the direct tags.** Loading a GTM container *and* a direct
 *    GA4/Ads/Meta tag double-counts every conversion, which silently corrupts the
 *    ROAS figures the client uses to set ad spend. When a container is present,
 *    only it loads and the rest are configured inside it.
 */
export default function TagScripts({ config }: { config: PublicTagConfig }) {
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChoice(readConsentCookie());
    setReady(true);

    // The banner writes the cookie and dispatches this; re-read rather than
    // lifting state, so the two components stay independent.
    const onChange = () => setChoice(readConsentCookie());
    window.addEventListener(`${CONSENT_COOKIE}:change`, onChange);
    return () => window.removeEventListener(`${CONSENT_COOKIE}:change`, onChange);
  }, []);

  // Nothing renders during the first paint: reading the cookie is a client-only
  // operation, and guessing would risk loading a tag the visitor declined.
  if (!ready) return null;
  if (!mayLoadTags(config.consentMode, choice)) return null;

  const viaGtm = config.gtmId !== null;

  return (
    <>
      {/*
        Consent Mode v2 defaults, declared before any Google tag loads. Under
        REQUIRED the visitor has already accepted by the time we get here, but
        the denied-first default still matters: it is what Google's own tags read
        if they load in any other order.
      */}
      {(viaGtm || config.ga4MeasurementId || config.googleAdsId) && (
        <Script id="google-consent-default" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',wait_for_update:500});
gtag('consent','update',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted'});`}
        </Script>
      )}

      {viaGtm && (
        <>
          <Script id="gtm" strategy="afterInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})
(window,document,'script','dataLayer','${config.gtmId}');`}
          </Script>
          {/*
            No <noscript> iframe fallback. It would need `frame-src` widened for
            every visitor including those with JavaScript enabled, and a shopper
            without JavaScript cannot complete a checkout here anyway.
          */}
        </>
      )}

      {!viaGtm && config.ga4MeasurementId && (
        <>
          <Script
            id="ga4-loader"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${config.ga4MeasurementId}`}
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());gtag('config','${config.ga4MeasurementId}');`}
          </Script>
        </>
      )}

      {!viaGtm && config.googleAdsId && (
        <>
          {!config.ga4MeasurementId && (
            <Script
              id="ads-loader"
              strategy="afterInteractive"
              src={`https://www.googletagmanager.com/gtag/js?id=${config.googleAdsId}`}
            />
          )}
          <Script id="ads-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());gtag('config','${config.googleAdsId}');`}
          </Script>
        </>
      )}

      {!viaGtm && config.metaPixelId && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${config.metaPixelId}');fbq('track','PageView');`}
        </Script>
      )}

      {config.clarityProjectId && (
        <Script id="clarity" strategy="afterInteractive">
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,'clarity','script','${config.clarityProjectId}');`}
        </Script>
      )}

      {config.hotjarSiteId && (
        <Script id="hotjar" strategy="afterInteractive">
          {`(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
h._hjSettings={hjid:${config.hotjarSiteId},hjsv:6};a=o.getElementsByTagName('head')[0];
r=o.createElement('script');r.async=1;r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;
a.appendChild(r);})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');`}
        </Script>
      )}

      {config.pinterestTagId && (
        <Script id="pinterest" strategy="afterInteractive">
          {`!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(
Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";
var t=document.createElement("script");t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];
r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");
pintrk('load','${config.pinterestTagId}');pintrk('page');`}
        </Script>
      )}

      {config.tiktokPixelId && (
        <Script id="tiktok" strategy="afterInteractive">
          {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js";
ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};
var o=document.createElement("script");o.type="text/javascript";o.async=!0;o.src=r+"?sdkid="+e+"&lib="+t;
var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
ttq.load('${config.tiktokPixelId}');ttq.page();}(window,document,'ttq');`}
        </Script>
      )}

      {config.snapPixelId && (
        <Script id="snap-pixel" strategy="afterInteractive">
          {`(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){
a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];
var s='script';var r=t.createElement(s);r.async=!0;r.src=n;
var u=t.getElementsByTagName(s)[0];u.parentNode.insertBefore(r,u);})(window,document,'https://sc-static.net/scevent.min.js');
snaptr('init','${config.snapPixelId}');snaptr('track','PAGE_VIEW');`}
        </Script>
      )}
    </>
  );
}
