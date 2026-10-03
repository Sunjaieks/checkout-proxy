/**
 * cert.mjs
 * Generate a root CA and dynamically sign leaf certificates per hostname.
 * Uses node-forge (already a dependency of this project).
 */
import forge from 'node-forge';

const { pki } = forge;

/**
 * Create a root CA key pair + self-signed certificate.
 * Returns { caKey, caCert } as forge objects, plus PEM strings.
 */
export function createRootCA() {
    const caKey = pki.rsa.generateKeyPair(2048);
    const caCert = pki.createCertificate();
    caCert.publicKey = caKey.publicKey;
    caCert.serialNumber = '01';
    caCert.validity.notBefore = new Date();
    caCert.validity.notAfter = new Date();
    caCert.validity.notAfter.setFullYear(caCert.validity.notBefore.getFullYear() + 10);

    const attrs = [
        { name: 'commonName', value: 'MITM Demo Root CA' },
        { name: 'organizationName', value: 'MITM Demo' },
    ];
    caCert.setSubject(attrs);
    caCert.setIssuer(attrs);
    caCert.setExtensions([
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true },
        { name: 'subjectKeyIdentifier' },
    ]);
    caCert.sign(caKey.privateKey, forge.md.sha256.create());

    return {
        caKey,
        caCert,
        caKeyPem: pki.privateKeyToPem(caKey.privateKey),
        caCertPem: pki.certificateToPem(caCert),
    };
}

/**
 * Generate a leaf TLS certificate for `hostname`, signed by the given root CA.
 * Returns { key, cert } as PEM strings ready for tls.createSecureContext().
 */
export function generateCert(hostname, caKey, caCert) {
    const leafKey = pki.rsa.generateKeyPair(2048);
    const leafCert = pki.createCertificate();
    leafCert.publicKey = leafKey.publicKey;
    leafCert.serialNumber = Date.now().toString(16);
    leafCert.validity.notBefore = new Date();
    leafCert.validity.notAfter = new Date();
    leafCert.validity.notAfter.setDate(leafCert.validity.notBefore.getDate() + 90);

    leafCert.setSubject([{ name: 'commonName', value: hostname }]);
    leafCert.setIssuer(caCert.subject.attributes);
    leafCert.setExtensions([
        { name: 'basicConstraints', cA: false },
        { name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
    ]);
    leafCert.sign(caKey.privateKey, forge.md.sha256.create());

    return {
        key: pki.privateKeyToPem(leafKey.privateKey),
        cert: pki.certificateToPem(leafCert),
    };
}