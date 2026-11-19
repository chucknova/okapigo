// @ts-check
/**
 * camera.js — the back camera, reading QR codes (O4 Scan).
 *
 *   openCamera(video)   starts the back camera into a <video>; says why if it can't
 *   createReader()      reads a QR code from the video, a few times a second
 *
 * Reading: Chrome on Android has a QR reader built in (BarcodeDetector). iPhones don't, so
 * there the app reads the picture itself with jsQR, a small library, loaded only when needed
 * (it's still part of the saved app, so it works offline too).
 */

/**
 * @typedef {'denied' | 'no-camera' | 'unavailable'} CameraProblem
 *   denied       the person (or a setting) said no to the camera     → how to allow it
 *   no-camera    this device has none                                → search instead
 *   unavailable  not over https, or the browser can't                → search instead
 */

/**
 * @param {HTMLVideoElement} video
 * @returns {Promise<{ ok: true, stop: () => void, torch: ((on: boolean) => Promise<void>) | null } | { ok: false, problem: CameraProblem }>}
 */
export async function openCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, problem: 'unavailable' };
  /** @type {MediaStream} */
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch (err) {
    const name = /** @type {any} */ (err)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError')
      return { ok: false, problem: 'denied' };
    if (name === 'NotFoundError' || name === 'OverconstrainedError')
      return { ok: false, problem: 'no-camera' };
    return { ok: false, problem: 'unavailable' };
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', ''); // iPhones: play in the page, not full screen
  video.muted = true;
  await video.play().catch(() => {});
  const [track] = stream.getVideoTracks();
  // The torch, where the phone has one (Android Chrome; not iPhones).
  const caps = /** @type {any} */ (track?.getCapabilities?.() ?? {});
  const torch = caps.torch
    ? (/** @type {boolean} */ on) =>
        track.applyConstraints(/** @type {any} */ ({ advanced: [{ torch: on }] }))
    : null;
  return {
    ok: true,
    torch,
    stop: () => {
      for (const t of stream.getTracks()) t.stop();
      video.srcObject = null;
    },
  };
}

/**
 * A QR reader for a playing video: `read(video)` → the code's text, or null.
 * @returns {Promise<{ read: (video: HTMLVideoElement) => Promise<string | null> }>}
 */
export async function createReader() {
  const Detector = /** @type {any} */ (globalThis).BarcodeDetector;
  if (Detector) {
    try {
      const formats = await Detector.getSupportedFormats?.();
      if (!formats || formats.includes('qr_code')) {
        const detector = new Detector({ formats: ['qr_code'] });
        return {
          read: async (video) => {
            if (video.readyState < 2) return null;
            const [hit] = await detector.detect(video).catch(() => []);
            return hit?.rawValue ?? null;
          },
        };
      }
    } catch {
      // fall through to jsQR
    }
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return {
    read: async (video) => {
      if (!ctx || video.readyState < 2 || !video.videoWidth) return null;
      // A smaller copy of the frame: plenty for a QR code a hand's length away, and quick.
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return (
        jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data ??
        null
      );
    },
  };
}

/** A short buzz on a good scan, two on a problem (designs: "The phone buzzes once…"). @param {'ok' | 'problem'} kind */
export function buzz(kind) {
  try {
    navigator.vibrate?.(kind === 'ok' ? 60 : [60, 80, 60]);
  } catch {
    // not every phone can
  }
}
