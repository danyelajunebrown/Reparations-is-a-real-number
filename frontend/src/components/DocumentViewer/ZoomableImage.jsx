import React, { useEffect, useRef, useState } from 'react';

/**
 * ZoomableImage — a mobile-first, cross-browser deep-zoom viewer for a scanned
 * primary source. Pinch/pan on touch; scroll/double-click to zoom on a pointer.
 *
 * Backed by OpenSeadragon, loaded LAZILY (dynamic import) so it never touches the
 * initial bundle — only opening a document pays for it.
 *
 * Cross-browser (Chrome, Chromium, Chrome-for-Android/WebView, Edge incl. mobile,
 * Safari, Firefox):
 *  - OpenSeadragon renders to <canvas> with unified pointer/touch handling, so
 *    pinch-zoom works the same on every engine.
 *  - We deliberately do NOT set crossOrigin on the image. Presigned S3 URLs are not
 *    guaranteed to send CORS headers; setting crossOrigin would make strict engines
 *    (Chrome/Edge/Android) REFUSE to load the image. Without it the image displays
 *    fine (the canvas may be "tainted", which only blocks pixel readback — we only
 *    ever draw, never read — so display is unaffected on all engines).
 *  - If OpenSeadragon can't load/parse the source, we fall back to a plain <img>
 *    (which still pans via native scroll and pinch-zooms on mobile).
 *
 * Props:
 *  - url          presigned image URL (single-image mode; the common case).
 *  - tileSources  optional OpenSeadragon tileSources (e.g. a IIIF info.json URL) —
 *                 takes precedence over `url` for tiled / IIIF deep-zoom sources.
 *  - alt          alt text for the fallback image.
 *  - background   viewer background (default black, matching the lightbox).
 */
export function ZoomableImage({ url, tileSources, alt, background = '#000' }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url && !tileSources) return undefined;
    let cancelled = false;
    let viewer;

    import('openseadragon')
      .then(({ default: OpenSeadragon }) => {
        if (cancelled || !containerRef.current) return;
        viewer = OpenSeadragon({
          element: containerRef.current,
          tileSources: tileSources || { type: 'image', url },
          // See the header note — never set crossOrigin on presigned S3.
          crossOriginPolicy: false,
          // Force the 2D-canvas drawer. OpenSeadragon 6 defaults to WebGL, but WebGL
          // texImage2D REFUSES a cross-origin image without CORS ("Error creating texture
          // in WebGL"), so the scan wouldn't render. The canvas drawer uses drawImage,
          // which displays cross-origin/tainted images fine (we only ever draw, never
          // read pixels). Robust for presigned S3 across every engine.
          drawer: 'canvas',
          // We render our own controls (below) so we don't need the button sprite.
          showNavigationControl: false,
          showNavigator: false,
          showSequenceControl: false,
          gestureSettingsTouch: { pinchToZoom: true, flickEnabled: true, dblClickToZoom: true, pinchRotate: false },
          gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true },
          gestureSettingsPen: { clickToZoom: false, dblClickToZoom: true },
          visibilityRatio: 1,
          minZoomImageRatio: 0.8,
          maxZoomPixelRatio: 5,
          constrainDuringPan: true,
          animationTime: 0.4,
          preserveImageSizeOnResize: true,
        });
        viewer.addHandler('open-failed', () => { if (!cancelled) setFailed(true); });
        viewerRef.current = viewer;
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => {
      cancelled = true;
      if (viewer) { try { viewer.destroy(); } catch (_) { /* noop */ } }
      viewerRef.current = null;
    };
  }, [url, tileSources]);

  const zoomBy = (factor) => {
    const v = viewerRef.current;
    if (!v) return;
    v.viewport.zoomBy(factor);
    v.viewport.applyConstraints();
  };
  const goHome = () => { const v = viewerRef.current; if (v) v.viewport.goHome(); };

  // Fallback: a plain image. Still pinch-zoomable on mobile and pannable via scroll.
  if (failed) {
    return (
      <img
        src={url}
        alt={alt || 'document'}
        style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }}
      />
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 320, flex: 1, alignSelf: 'stretch' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background }} />
      {/* Overlay controls — large tap targets, touch-friendly, cross-browser. */}
      <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ZoomButton label="Zoom in" onClick={() => zoomBy(1.5)}>+</ZoomButton>
        <ZoomButton label="Zoom out" onClick={() => zoomBy(1 / 1.5)}>−</ZoomButton>
        <ZoomButton label="Reset zoom" onClick={goHome} small>⤢</ZoomButton>
      </div>
    </div>
  );
}

function ZoomButton({ children, label, onClick, small }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 40, height: 40,
        background: 'rgba(0,0,0,0.55)',
        border: '1px solid rgba(255,255,255,0.35)',
        color: '#fff',
        borderRadius: 6,
        fontSize: small ? 16 : 22,
        lineHeight: 1,
        cursor: 'pointer',
        touchAction: 'manipulation',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}
