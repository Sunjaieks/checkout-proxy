/**
 * Tests for generateSerialNumber in proxy-server.js
 * Validates RFC 5280 compliance: positive integer, ≤20 bytes,
 * minimal-length DER encoding (no redundant leading 0x00).
 */

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

const { generateSerialNumber } = require('../proxy-server.js');
const forge = require('node-forge');

describe('generateSerialNumber', () => {
    test('returns a 32-char hex string (16 bytes, no prepended 0x00)', () => {
        const sn = generateSerialNumber();
        expect(typeof sn).toBe('string');
        expect(sn).toMatch(/^[0-9a-f]{32}$/);
    });

    test('first byte MSB is always 0 (positive integer)', () => {
        for (let i = 0; i < 2000; i++) {
            const sn = generateSerialNumber();
            const firstByte = parseInt(sn.slice(0, 2), 16);
            expect(firstByte & 0x80).toBe(0);
        }
    });

    test('first byte is never 0x00 (DER minimal-length)', () => {
        for (let i = 0; i < 2000; i++) {
            const sn = generateSerialNumber();
            const firstByte = parseInt(sn.slice(0, 2), 16);
            expect(firstByte).not.toBe(0x00);
            expect(firstByte).toBeGreaterThanOrEqual(0x01);
            expect(firstByte).toBeLessThanOrEqual(0x7f);
        }
    });

    test('produces unique values across many calls', () => {
        const seen = new Set();
        const N = 1000;
        for (let i = 0; i < N; i++) {
            seen.add(generateSerialNumber());
        }
        expect(seen.size).toBe(N);
    });

    test('forge accepts the value and produces a valid signed certificate', () => {
        const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
        const cert = forge.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = generateSerialNumber();
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date(Date.now() + 86400000);
        const attrs = [{ name: 'commonName', value: 'test.local' }];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.sign(keys.privateKey, forge.md.sha256.create());

        const pem = forge.pki.certificateToPem(cert);
        const parsed = forge.pki.certificateFromPem(pem);
        // Round-trip: the parsed serial number should match what we set
        // (no leading 0x00 stripped, no padding added by DER).
        expect(parsed.serialNumber).toBe(cert.serialNumber);
        expect(parsed.serialNumber).toMatch(/^[0-9a-f]{32}$/);
        // First byte MSB must be 0 (positive integer per RFC 5280).
        expect(parseInt(parsed.serialNumber.slice(0, 2), 16) & 0x80).toBe(0);
        // First byte must be non-zero so the DER INTEGER encoding is minimal-length.
        expect(parseInt(parsed.serialNumber.slice(0, 2), 16)).not.toBe(0);
    }, 15000);
});
