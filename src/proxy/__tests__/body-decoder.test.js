/**
 * Tests for body-decoder.js utilities
 * Tests content type detection and charset handling
 */

function findHeader(headers, name) {
    if (!headers || !name) return undefined;
    const lowerName = name.toLowerCase();
    for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lowerName) {
            return headers[key];
        }
    }
    return undefined;
}

// Mock electron before importing anything that depends on it
jest.mock('electron', () => ({
    app: {
        getPath: (name) => {
            const os = require('os');
            const path = require('path');
            if (name === 'userData') {
                return path.join(os.tmpdir(), 'checkout-proxy-test');
            }
            return os.tmpdir();
        }
    }
}));

const {
    isDisplayableContentType,
    parseCharset,
    isSupportedCharset,
    isUtf8Charset,
    isEucJpCharset,
    isLatin1Charset,
    parseMetaCharset
} = require('../body-decoder.js');

describe('body-decoder utilities', () => {
    describe('isDisplayableContentType', () => {
        test('returns true for text/* content types', () => {
            expect(isDisplayableContentType('text/plain')).toBe(true);
            expect(isDisplayableContentType('text/html')).toBe(true);
            expect(isDisplayableContentType('text/css')).toBe(true);
            expect(isDisplayableContentType('text/javascript')).toBe(true);
            expect(isDisplayableContentType('text/xml')).toBe(true);
            expect(isDisplayableContentType('text/csv')).toBe(true);
        });

        test('returns true for JSON content types', () => {
            expect(isDisplayableContentType('application/json')).toBe(true);
            expect(isDisplayableContentType('application/ld+json')).toBe(true);
            expect(isDisplayableContentType('application/graphql+json')).toBe(true);
        });

        test('returns true for XML content types', () => {
            expect(isDisplayableContentType('application/xml')).toBe(true);
            expect(isDisplayableContentType('application/xhtml+xml')).toBe(true);
            expect(isDisplayableContentType('application/atom+xml')).toBe(true);
            expect(isDisplayableContentType('application/rss+xml')).toBe(true);
        });

        test('returns true for JavaScript content types', () => {
            expect(isDisplayableContentType('application/javascript')).toBe(true);
            expect(isDisplayableContentType('application/x-javascript')).toBe(true);
        });

        test('returns true for form data content type', () => {
            expect(isDisplayableContentType('application/x-www-form-urlencoded')).toBe(true);
        });

        test('returns false for binary content types', () => {
            expect(isDisplayableContentType('application/octet-stream')).toBe(false);
            expect(isDisplayableContentType('image/png')).toBe(false);
            expect(isDisplayableContentType('image/jpeg')).toBe(false);
            expect(isDisplayableContentType('audio/mpeg')).toBe(false);
            expect(isDisplayableContentType('video/mp4')).toBe(false);
            expect(isDisplayableContentType('application/pdf')).toBe(false);
            expect(isDisplayableContentType('application/zip')).toBe(false);
        });

        test('handles content type with charset', () => {
            expect(isDisplayableContentType('text/html; charset=utf-8')).toBe(true);
            expect(isDisplayableContentType('application/json; charset=UTF-8')).toBe(true);
            expect(isDisplayableContentType('image/png; charset=utf-8')).toBe(false);
        });

        test('handles null/undefined/empty', () => {
            expect(isDisplayableContentType(null)).toBe(false);
            expect(isDisplayableContentType(undefined)).toBe(false);
            expect(isDisplayableContentType('')).toBe(false);
        });

        test('is case insensitive', () => {
            expect(isDisplayableContentType('TEXT/HTML')).toBe(true);
            expect(isDisplayableContentType('Application/JSON')).toBe(true);
            expect(isDisplayableContentType('TEXT/PLAIN')).toBe(true);
        });
    });

    describe('parseCharset', () => {
        test('parses charset from Content-Type', () => {
            expect(parseCharset('text/html; charset=utf-8')).toBe('utf-8');
            expect(parseCharset('text/html; charset=UTF-8')).toBe('utf-8');
            expect(parseCharset('application/json; charset=utf-8')).toBe('utf-8');
        });

        test('parses charset with quotes', () => {
            expect(parseCharset('text/html; charset="utf-8"')).toBe('utf-8');
            expect(parseCharset("text/html; charset='utf-8'")).toBe('utf-8');
        });

        test('parses charset with spaces', () => {
            expect(parseCharset('text/html; charset = utf-8')).toBe('utf-8');
            expect(parseCharset('text/html;charset=utf-8')).toBe('utf-8');
        });

        test('parses various charsets', () => {
            expect(parseCharset('text/html; charset=euc-jp')).toBe('euc-jp');
            expect(parseCharset('text/html; charset=shift_jis')).toBe('shift_jis');
            expect(parseCharset('text/html; charset=iso-8859-1')).toBe('iso-8859-1');
        });

        test('returns null for no charset', () => {
            expect(parseCharset('text/html')).toBeNull();
            expect(parseCharset('application/json')).toBeNull();
        });

        test('returns null for null/undefined/empty', () => {
            expect(parseCharset(null)).toBeNull();
            expect(parseCharset(undefined)).toBeNull();
            expect(parseCharset('')).toBeNull();
        });
    });

    describe('isSupportedCharset', () => {
        test('supports UTF-8 variants', () => {
            expect(isSupportedCharset('utf-8')).toBe(true);
            expect(isSupportedCharset('UTF-8')).toBe(true);
            expect(isSupportedCharset('utf8')).toBe(true);
            expect(isSupportedCharset('UTF8')).toBe(true);
        });

        test('supports EUC-JP variants', () => {
            expect(isSupportedCharset('euc-jp')).toBe(true);
            expect(isSupportedCharset('EUC-JP')).toBe(true);
            expect(isSupportedCharset('eucjp')).toBe(true);
            expect(isSupportedCharset('EUCJP')).toBe(true);
        });

        test('returns true for null/undefined (assumes UTF-8)', () => {
            expect(isSupportedCharset(null)).toBe(true);
            expect(isSupportedCharset(undefined)).toBe(true);
        });

        test('supports ISO-8859-1 / Latin-1 variants', () => {
            expect(isSupportedCharset('iso-8859-1')).toBe(true);
            expect(isSupportedCharset('ISO-8859-1')).toBe(true);
            expect(isSupportedCharset('latin1')).toBe(true);
            expect(isSupportedCharset('Latin1')).toBe(true);
        });

        test('rejects other charsets', () => {
            expect(isSupportedCharset('shift_jis')).toBe(false);
            expect(isSupportedCharset('gb2312')).toBe(false);
        });
    });

    describe('isUtf8Charset', () => {
        test('returns true for UTF-8 variants', () => {
            expect(isUtf8Charset('utf-8')).toBe(true);
            expect(isUtf8Charset('UTF-8')).toBe(true);
            expect(isUtf8Charset('utf8')).toBe(true);
            expect(isUtf8Charset('UTF8')).toBe(true);
        });

        test('returns true for null/undefined (default UTF-8)', () => {
            expect(isUtf8Charset(null)).toBe(true);
            expect(isUtf8Charset(undefined)).toBe(true);
        });

        test('returns false for other charsets', () => {
            expect(isUtf8Charset('euc-jp')).toBe(false);
            expect(isUtf8Charset('shift_jis')).toBe(false);
        });
    });

    describe('isEucJpCharset', () => {
        test('returns true for EUC-JP variants', () => {
            expect(isEucJpCharset('euc-jp')).toBe(true);
            expect(isEucJpCharset('EUC-JP')).toBe(true);
            expect(isEucJpCharset('eucjp')).toBe(true);
            expect(isEucJpCharset('EUCJP')).toBe(true);
        });

        test('returns false for null/undefined', () => {
            expect(isEucJpCharset(null)).toBe(false);
            expect(isEucJpCharset(undefined)).toBe(false);
        });

        test('returns false for other charsets', () => {
            expect(isEucJpCharset('utf-8')).toBe(false);
            expect(isEucJpCharset('shift_jis')).toBe(false);
        });
    });

    describe('isLatin1Charset', () => {
        test('returns true for ISO-8859-1 / Latin-1 variants', () => {
            expect(isLatin1Charset('iso-8859-1')).toBe(true);
            expect(isLatin1Charset('ISO-8859-1')).toBe(true);
            expect(isLatin1Charset('latin1')).toBe(true);
            expect(isLatin1Charset('Latin1')).toBe(true);
        });

        test('returns false for null/undefined', () => {
            expect(isLatin1Charset(null)).toBe(false);
            expect(isLatin1Charset(undefined)).toBe(false);
        });

        test('returns false for other charsets', () => {
            expect(isLatin1Charset('utf-8')).toBe(false);
            expect(isLatin1Charset('euc-jp')).toBe(false);
        });
    });

    describe('parseMetaCharset', () => {
        test('parses <meta charset="..."> tag', () => {
            expect(parseMetaCharset('<html><head><meta charset="EUC-JP"></head>')).toBe('euc-jp');
            expect(parseMetaCharset('<html><head><meta charset="utf-8"></head>')).toBe('utf-8');
            expect(parseMetaCharset('<meta charset="iso-8859-1">')).toBe('iso-8859-1');
        });

        test("parses <meta charset='...'> with single quotes", () => {
            expect(parseMetaCharset("<meta charset='EUC-JP'>")).toBe('euc-jp');
        });

        test('parses <meta charset=...> without quotes', () => {
            expect(parseMetaCharset('<meta charset=EUC-JP>')).toBe('euc-jp');
        });

        test('parses meta http-equiv Content-Type with charset', () => {
            expect(parseMetaCharset('<meta http-equiv="Content-Type" content="text/html; charset=EUC-JP">')).toBe(
                'euc-jp'
            );
            expect(parseMetaCharset('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">')).toBe(
                'iso-8859-1'
            );
        });

        test('is case insensitive for tag matching', () => {
            expect(parseMetaCharset('<META CHARSET="euc-jp">')).toBe('euc-jp');
            expect(parseMetaCharset('<Meta Charset="EUC-JP">')).toBe('euc-jp');
        });

        test('returns null for no meta charset', () => {
            expect(parseMetaCharset('<html><head><title>Test</title></head></html>')).toBeNull();
            expect(parseMetaCharset('<meta name="viewport" content="width=device-width">')).toBeNull();
        });

        test('returns null for null/undefined/empty', () => {
            expect(parseMetaCharset(null)).toBeNull();
            expect(parseMetaCharset(undefined)).toBeNull();
            expect(parseMetaCharset('')).toBeNull();
        });

        test('only searches first 4096 characters', () => {
            const padding = 'x'.repeat(4096);
            expect(parseMetaCharset(padding + '<meta charset="EUC-JP">')).toBeNull();
        });

        test('finds charset within first 1024 characters', () => {
            const padding = 'x'.repeat(990);
            expect(parseMetaCharset(padding + '<meta charset="EUC-JP">')).toBe('euc-jp');
        });

        test('does not find charset beyond 1024 characters', () => {
            const padding = 'x'.repeat(4000);
            expect(parseMetaCharset(padding + '<meta charset="EUC-JP">')).toBeNull();
        });
    });

    describe('findHeader', () => {
        test('finds header case-insensitively', () => {
            const headers = {
                'Content-Type': 'application/json',
                'X-Custom-Header': 'value'
            };

            expect(findHeader(headers, 'content-type')).toBe('application/json');
            expect(findHeader(headers, 'Content-Type')).toBe('application/json');
            expect(findHeader(headers, 'CONTENT-TYPE')).toBe('application/json');
            expect(findHeader(headers, 'x-custom-header')).toBe('value');
        });

        test('returns undefined for missing header', () => {
            const headers = { 'Content-Type': 'application/json' };
            expect(findHeader(headers, 'Accept')).toBeUndefined();
        });

        test('handles null/undefined headers', () => {
            expect(findHeader(null, 'Content-Type')).toBeUndefined();
            expect(findHeader(undefined, 'Content-Type')).toBeUndefined();
        });

        test('handles null/undefined header name', () => {
            const headers = { 'Content-Type': 'application/json' };
            expect(findHeader(headers, null)).toBeUndefined();
            expect(findHeader(headers, undefined)).toBeUndefined();
        });
    });
});
