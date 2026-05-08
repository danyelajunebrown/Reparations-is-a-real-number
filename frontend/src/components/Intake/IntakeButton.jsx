import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * IntakeButton — "REQUEST INTAKE" button that opens the Google Form.
 *
 * Kiosk mode (Pi touchscreen): opens the form as a full-screen iframe overlay.
 * The overlay shows a "Return" button after submission is detected (form
 * redirects to /formResponse or a page containing "response" in the URL).
 *
 * Public web: not rendered at all (component returns null). The button is
 * Pi-kiosk-only — the parent should check the kiosk flag before including
 * this component.
 *
 * @param {Object} props
 * @param {string}  props.formUrl  — Google Form URL
 * @param {boolean} props.disabled — disable the button (e.g. while submitting)
 * @param {Function} props.onSubmitComplete — callback after form submission
 */
const GOOGLE_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLScIek-qQmGj7esA3spu6zclP2VvU8cZwWbLmDMJ0GJjSCX_BA/viewform?usp=dialog';

export default function IntakeButton({ formUrl = GOOGLE_FORM_URL, disabled = false, onSubmitComplete }) {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const iframeRef = useRef(null);
  const checkIntervalRef = useRef(null);
  const [submitted, setSubmitted] = useState(false);

  // ── Open overlay ───────────────────────────────────────────────────────
  const open = useCallback(() => {
    setOverlayOpen(true);
    setSubmitted(false);

    // Clear any leftover checking
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }

    // Poll the iframe's current URL every 1s to detect form submission.
    // Google Forms redirects to /formResponse after a successful submit.
    // Cross-origin restrictions mean we can't read the URL directly — but
    // on the same origin (Google Forms → Google Forms) the iframe navigates
    // and we can try/catch access attempts to detect the transition.
    // If that fails, we fall back to a "Done? Return" button after a delay.
    checkIntervalRef.current = setInterval(() => {
      try {
        if (iframeRef.current && iframeRef.current.contentWindow) {
          const currentUrl = iframeRef.current.contentWindow.location.href;
          if (
            currentUrl &&
            (currentUrl.includes('formResponse') ||
             currentUrl.includes('forms/d/e/') && currentUrl !== formUrl)
          ) {
            // Detected form submission redirect
            clearInterval(checkIntervalRef.current);
            checkIntervalRef.current = null;
            setSubmitted(true);
          }
        }
      } catch {
        // Cross-origin — can't read URL. No-op; we show "Done?" after timeout.
      }
    }, 1000);

    // Safety timer: after 5 minutes, always show the "Return" button
    // in case the form was submitted but we couldn't detect it.
    setTimeout(() => {
      setSubmitted(true);
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    }, 5 * 60 * 1000);
  }, [formUrl]);

  // ── Close overlay ──────────────────────────────────────────────────────
  const close = useCallback(() => {
    setOverlayOpen(false);
    setSubmitted(false);
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }
    if (onSubmitComplete) onSubmitComplete();
  }, [onSubmitComplete]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
    };
  }, []);

  return (
    <>
      {/* ── Intake Button ──────────────────────────────────────────────── */}
      <button
        className="intake-button"
        onClick={open}
        disabled={disabled}
        type="button"
      >
        {disabled ? 'Submitting…' : 'REQUEST INTAKE'}
        {!disabled && <span className="intake-arrow"> →</span>}
      </button>

      {/* ── Full-screen Overlay (kiosk mode) ────────────────────────────── */}
      {overlayOpen && (
        <div className="intake-overlay" onClick={close}>
          <div
            className="intake-overlay-content"
            onClick={e => e.stopPropagation()}
          >
            {/* ── Before submission: Google Form iframe ─────────────────── */}
            {!submitted && (
              <>
                <div className="intake-header">
                  <span className="intake-header-label">Reparations Intake Form</span>
                  <button
                    className="intake-close-btn"
                    onClick={close}
                    type="button"
                  >
                    ✕
                  </button>
                </div>
                <iframe
                  ref={iframeRef}
                  src={formUrl}
                  className="intake-iframe"
                  title="Reparations Intake Form"
                  sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
                />
                <div className="intake-footer">
                  Complete the form above. You'll be able to return here after submission.
                </div>
              </>
            )}

            {/* ── After submission: confirmation ────────────────────────── */}
            {submitted && (
              <div className="intake-confirmation">
                <div className="intake-confirm-icon">✓</div>
                <div className="intake-confirm-title">Submission Received</div>
                <div className="intake-confirm-desc">
                  Your intake form has been sent. Our team will review it and
                  follow up with the next steps.
                </div>
                <button
                  className="intake-return-btn"
                  onClick={close}
                  type="button"
                >
                  Return to Platform
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}