import http2 from 'node:http2';
import tls from 'node:tls';
import forge from 'node-forge';

// ---- shared CA + per-host leaf cert generator (mirrors real code) ----
const caK = forge.pki.rsa.generateKeyPair(2048);
const caC = forge.pki.createCertificate();
caC.publicKey = caK.publicKey; caC.serialNumber='01';
caC.validity.notBefore=new Date(Date.now()-864e5); caC.validity.notAfter=new Date(Date.now()+864e5);
const caA=[{name:'commonName',value:'CA'}]; caC.setSubject(caA); caC.setIssuer(caA);
caC.setExtensions([{name:'basicConstraints',cA:true}]); caC.sign(caK.privateKey, forge.md.sha256.create());
const caCertPem = forge.pki.certificateToPem(caC);
const caKeyPem  = forge.pki.privateKeyToPem(caK.privateKey);

function genCert(host){
  const k=forge.pki.rsa.generateKeyPair(2048);              // per-host keypair, like generateServerCertificate
  const c=forge.pki.createCertificate(); c.publicKey=k.publicKey; c.serialNumber='0'+Math.floor(Math.random()*1e8);
  c.validity.notBefore=new Date(Date.now()-864e5); c.validity.notAfter=new Date(Date.now()+864e5);
  c.setSubject([{name:'commonName',value:host}]); c.setIssuer(caC.subject.attributes);
  c.setExtensions([{name:'basicConstraints',cA:false},{name:'subjectAltName',altNames:[{type:2,value:host}]}]);
  c.sign(caK.privateKey, forge.md.sha256.create());
  return {key:forge.pki.privateKeyToPem(k.privateKey), cert:forge.pki.certificateToPem(c)};
}

const mb = b => (b/1024/1024).toFixed(1);
function snap(){ global.gc?.(); global.gc?.(); const m=process.memoryUsage(); return m; }

const h2settings = { enableConnectProtocol:false, enablePush:false, initialWindowSize:1024*1024*32 };
const N = parseInt(process.argv[3] || '500', 10);
const mode = process.argv[2];

if (mode === 'perhost') {
  // Approach A: one non-listening http2 server per host, each with its own static cert. All retained.
  const before = snap();
  const servers = [];
  for (let i=0;i<N;i++){
    const {key,cert}=genCert(`host-${i}.example.test`);
    const s = http2.createSecureServer({ key, cert, allowHTTP1:true, ciphers:'ALL:!LOW:!DSS:!EXP', settings:h2settings });
    s.on('request',(req,res)=>res.end('ok'));
    servers.push(s);
  }
  const after = snap();
  console.log(`[per-host]  N=${N}  ΔRSS=${mb(after.rss-before.rss)}MB  ΔheapUsed=${mb(after.heapUsed-before.heapUsed)}MB  → ${((after.rss-before.rss)/N/1024).toFixed(1)} KB/host`);
  console.log('kept', servers.length);
} else if (mode === 'snicb') {
  // Approach B: ONE http2 server with SNICallback. Cert PEMs cached per host (like certCache);
  // SecureContext created fresh per SNI hit and NOT retained (transient, GC-eligible).
  const certCache = new Map();
  const before = snap();
  const server = http2.createSecureServer({
    key: caKeyPem, cert: caCertPem, allowHTTP1:true, ciphers:'ALL:!LOW:!DSS:!EXP', settings:h2settings,
    SNICallback: (servername, cb) => {
      let pem = certCache.get(servername);
      if (!pem) { pem = genCert(servername); certCache.set(servername, pem); }
      cb(null, tls.createSecureContext(pem)); // transient context
    }
  });
  server.on('request',(req,res)=>res.end('ok'));
  // Simulate N distinct hosts having connected: populate the PEM cache (retained) and
  // build+drop a SecureContext for each (transient, as in a real handshake).
  for (let i=0;i<N;i++){
    const host=`host-${i}.example.test`;
    const pem = genCert(host); certCache.set(host, pem);
    const ctx = tls.createSecureContext(pem); // created during handshake
    void ctx;                                  // dropped immediately (no retention)
  }
  const after = snap();
  console.log(`[sni+cache] N=${N}  ΔRSS=${mb(after.rss-before.rss)}MB  ΔheapUsed=${mb(after.heapUsed-before.heapUsed)}MB  → ${((after.rss-before.rss)/N/1024).toFixed(1)} KB/host`);
  console.log('cacheSize', certCache.size, 'server', !!server);
} else if (mode === 'ctxheld') {
  // Reference: what if SecureContexts were RETAINED (e.g. addContext / a context cache)?
  const before = snap();
  const server = http2.createSecureServer({ key: caKeyPem, cert: caCertPem, allowHTTP1:true, settings:h2settings });
  const ctxs = [];
  for (let i=0;i<N;i++){ ctxs.push(tls.createSecureContext(genCert(`host-${i}.example.test`))); }
  const after = snap();
  console.log(`[ctx-held] N=${N}  ΔRSS=${mb(after.rss-before.rss)}MB  ΔheapUsed=${mb(after.heapUsed-before.heapUsed)}MB  → ${((after.rss-before.rss)/N/1024).toFixed(1)} KB/host`);
  console.log('kept', ctxs.length, 'server', !!server);
}
process.exit(0);
