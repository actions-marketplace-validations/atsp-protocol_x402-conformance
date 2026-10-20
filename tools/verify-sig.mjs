// Owner-signature check for proofline.json, the same scheme as `proofline contract verify-sig`:
// a DSSE envelope (payloadType application/vnd.proofline.contract-sha256) whose payload is sha256 of the canonical
// contract, signed by the key pinned in guard/owner.pub. Prints one JSON line. Exit 0 = signed and valid,
// 3 = unsigned (awaiting owner signature), 1 = present but invalid.
import crypto from 'node:crypto';
import fs from 'node:fs';

const PT = 'application/vnd.proofline.contract-sha256';
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : (v && typeof v === 'object') ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);
const pae = (t, b) => Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(t)} `), Buffer.from(t), Buffer.from(` ${b.length} `), b]);
const hash = crypto.createHash('sha256').update(canonical(JSON.parse(fs.readFileSync('proofline.json', 'utf8')))).digest('hex');
const out = (o, code) => { console.log(JSON.stringify({ contract_sha256: hash, ...o })); process.exit(code); };
if (!fs.existsSync('proofline.json.sig')) out({ status: 'unsigned: awaiting owner signature' }, 3);
let env;
try { env = JSON.parse(fs.readFileSync('proofline.json.sig', 'utf8')); } catch { out({ status: 'invalid: not JSON' }, 1); }
if (env.payloadType !== PT) out({ status: 'invalid: payloadType' }, 1);
const payload = Buffer.from(env.payload || '', 'base64');
if (payload.toString('utf8') !== hash) out({ status: 'invalid: signature is not over the current contract' }, 1);
try {
  const key = crypto.createPublicKey(fs.readFileSync('guard/owner.pub', 'utf8'));
  const ok = crypto.verify(null, pae(PT, payload), key, Buffer.from(env.signatures?.[0]?.sig || '', 'base64'));
  out({ status: ok ? 'signed: owner signature matches guard/owner.pub' : 'invalid: does not verify against guard/owner.pub', keyid: env.signatures?.[0]?.keyid }, ok ? 0 : 1);
} catch { out({ status: 'invalid: guard/owner.pub unusable' }, 1); }
