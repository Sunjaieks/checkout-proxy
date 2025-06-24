/**
 * Body decoder utilities for handling content type and charset
 */

// Content types that are suitable for display in text editors
const DISPLAYABLE_CONTENT_TYPES = new Set([
    'text/plain',
    'text/html',
    'text/css',
    'text/javascript',
    'text/xml',
    'image/svg+xml',
    'text/csv',
    'text/markdown',
    'application/json',
    'application/xml',
    'application/javascript',
    'application/x-javascript',
    'application/ld+json',
    'application/xhtml+xml',
    'application/atom+xml',
    'application/rss+xml',
    'application/x-www-form-urlencoded',
    'application/graphql',
    'application/graphql+json'
]);

// Check if content type is displayable (text-like)
const DISPLAYABLE_TYPE_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/javascript'];

/**
 * Determine if a content type is suitable for text display
 * @param {string} contentType - The Content-Type header value
 * @returns {boolean}
 */
export function isDisplayableContentType(contentType) {
    if (!contentType) return false;

    // Parse the content type (remove charset and other parameters)
    const mimeType = contentType.split(';')[0].trim().toLowerCase();

    // Check exact match first
    if (DISPLAYABLE_CONTENT_TYPES.has(mimeType)) {
        return true;
    }

    // Check prefix matches
    for (const prefix of DISPLAYABLE_TYPE_PREFIXES) {
        if (mimeType.startsWith(prefix)) {
            return true;
        }
    }

    return false;
}

/**
 * Parse charset from Content-Type header
 * @param {string} contentType - The Content-Type header value
 * @returns {string|null} - The charset value or null if not specified
 */
export function parseCharset(contentType) {
    if (!contentType) return null;

    // Look for charset=xxx in the content type
    const charsetMatch = contentType.match(/charset\s*=\s*["']?([^"';\s]+)["']?/i);
    if (charsetMatch && charsetMatch[1]) {
        return charsetMatch[1].toLowerCase().trim();
    }

    return null;
}

/**
 * Check if charset is supported
 * Supported: utf-8, euc-jp, iso-8859-1 (latin1)
 * @param {string} charset - The charset value
 * @returns {boolean}
 */
export function isSupportedCharset(charset) {
    if (!charset) return true; // No charset specified, assume UTF-8
    const normalized = charset.toLowerCase().replace(/[_-]/g, '');
    return normalized === 'utf8' || normalized === 'eucjp' || normalized === 'iso88591' || normalized === 'latin1';
}

/**
 * Check if charset is UTF-8
 * @param {string} charset - The charset value
 * @returns {boolean}
 */
export function isUtf8Charset(charset) {
    if (!charset) return true; // No charset specified, assume UTF-8
    const normalized = charset.toLowerCase().replace(/[_-]/g, '');
    return normalized === 'utf8';
}

/**
 * Check if charset is EUC-JP
 * @param {string} charset - The charset value
 * @returns {boolean}
 */
export function isEucJpCharset(charset) {
    if (!charset) return false;
    const normalized = charset.toLowerCase().replace(/[_-]/g, '');
    return normalized === 'eucjp';
}

/**
 * Check if charset is ISO-8859-1 (Latin-1)
 * @param {string} charset - The charset value
 * @returns {boolean}
 */
export function isLatin1Charset(charset) {
    if (!charset) return false;
    const normalized = charset.toLowerCase().replace(/[_-]/g, '');
    return normalized === 'iso88591' || normalized === 'latin1';
}

/**
 * Parse charset from HTML meta tags.
 * Matches <meta charset="EUC-JP"> and <meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">
 * Only searches the first 1024 characters (meta tags should be in <head>).
 * @param {string} htmlString - The HTML content string
 * @returns {string|null} - The charset value or null if not found
 */
export function parseMetaCharset(htmlString) {
    if (!htmlString) return null;
    const searchArea = htmlString.substring(0, 1024);
    const match = searchArea.match(/<meta[^>]+charset\s*=\s*["']?([^"';\s>]+)/i);
    if (match && match[1]) {
        return match[1].toLowerCase().trim();
    }
    return null;
}
