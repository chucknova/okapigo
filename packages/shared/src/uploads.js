// @ts-check
/**
 * uploads.js — the upload limits and their words, shared by the server (@okapigo/media checks
 * every file) and the staff app (it checks the size BEFORE sending, so a phone on 3G doesn't
 * spend minutes uploading a file that will be refused). Stage 19b.
 */

/** 10 MB: a phone's full-size photo fits; a video or a scan of a book doesn't. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** What the file picker offers (the server checks the bytes anyway). */
export const ACCEPTED_PICTURES = 'image/jpeg,image/png,image/webp';

/** "14 MB", "4.3 MB", "800 KB" @param {number} bytes */
export const sizeWords = (bytes) =>
  bytes >= 1024 * 1024
    ? `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * "That photo is 14 MB. Use one under 10 MB." — or null when it's small enough.
 * @param {'photo' | 'logo'} kind @param {number} bytes
 */
export const tooBigLine = (kind, bytes) =>
  bytes > MAX_UPLOAD_BYTES
    ? `That ${kind} is ${sizeWords(bytes)}. Use one under ${sizeWords(MAX_UPLOAD_BYTES)}.`
    : null;
