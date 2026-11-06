/*
 * End-to-end encryption for sync.
 * - Each account has one random data key. Everything is encrypted with it
 *   (AES-GCM) on the device before upload, so the server only ever stores scrambled data.
 * - The data key is stored on the server only "wrapped" (encrypted) twice:
 *   with a key made from your password, and with a key made from your recovery key.
 * - On a device, the unwrapped data key is kept as a non-exportable key in local storage.
 */
const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function b64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const PW_ITER = 310_000;
const RK_ITER = 100_000;

async function kek(secret: string, salt: Uint8Array, iterations: number) {
  const base = await subtle().importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key: CryptoKey, data: Uint8Array): Promise<string> {
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
async function unseal(key: CryptoKey, s: string): Promise<Uint8Array> {
  const u = unb64(s);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) as BufferSource }, key, u.subarray(12) as BufferSource));
}
const importDek = (raw: Uint8Array) => subtle().importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);

/* ---- recovery key: 32 letters/digits shown as XXXX-XXXX-… ---- */
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid mix-ups
function newRecoveryKey() {
  const r = rand(32); let s = '';
  for (let i = 0; i < 32; i++) s += B32[r[i] % 32];
  return s.match(/.{4}/g)!.join('-');
}
export const normalizeRecovery = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface KeyRow { salt: string; wrapped: string; rsalt: string; rwrapped: string }

/** First sign-in: make the data key and lock it with the password and a new recovery key */
export async function createKeys(password: string): Promise<{ row: KeyRow; dek: CryptoKey; recovery: string }> {
  const raw = rand(32), salt = rand(16), rsalt = rand(16), recovery = newRecoveryKey();
  const row: KeyRow = {
    salt: b64(salt), wrapped: await seal(await kek(password, salt, PW_ITER), raw),
    rsalt: b64(rsalt), rwrapped: await seal(await kek(normalizeRecovery(recovery), rsalt, RK_ITER), raw),
  };
  return { row, dek: await importDek(raw), recovery };
}
export async function unlockWithPassword(row: KeyRow, password: string): Promise<CryptoKey> {
  return importDek(await unseal(await kek(password, unb64(row.salt), PW_ITER), row.wrapped));
}
/** After a password reset: open with the recovery key, then lock again with the new password */
export async function unlockWithRecovery(row: KeyRow, recovery: string, newPassword: string): Promise<{ dek: CryptoKey; row: Pick<KeyRow, 'salt' | 'wrapped'> }> {
  const raw = await unseal(await kek(normalizeRecovery(recovery), unb64(row.rsalt), RK_ITER), row.rwrapped);
  const salt = rand(16);
  return { dek: await importDek(raw), row: { salt: b64(salt), wrapped: await seal(await kek(newPassword, salt, PW_ITER), raw) } };
}
/** Password changed while signed in: lock the same data key with the new password */
export async function rewrapWithPassword(row: KeyRow, oldPassword: string, newPassword: string): Promise<Pick<KeyRow, 'salt' | 'wrapped'>> {
  const raw = await unseal(await kek(oldPassword, unb64(row.salt), PW_ITER), row.wrapped);
  const salt = rand(16);
  return { salt: b64(salt), wrapped: await seal(await kek(newPassword, salt, PW_ITER), raw) };
}

export const encryptJSON = async (dek: CryptoKey, v: unknown) => seal(dek, enc.encode(JSON.stringify(v)));
export const decryptJSON = async <T = unknown>(dek: CryptoKey, s: string): Promise<T> => JSON.parse(dec.decode(await unseal(dek, s)));

/* ---- sharing: a project key, locked for one person using their public key (ECIES: P-256 + AES-GCM) ---- */
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
export async function newProjectKey(): Promise<{ key: CryptoKey; raw: Uint8Array }> {
  const raw = rand(32);
  return { raw, key: await subtle().importKey('raw', raw as BufferSource, 'AES-GCM', true, ['encrypt', 'decrypt']) };
}
export const importProjectKey = (raw: Uint8Array) => subtle().importKey('raw', raw as BufferSource, 'AES-GCM', true, ['encrypt', 'decrypt']);
export const exportProjectKey = async (k: CryptoKey) => new Uint8Array(await subtle().exportKey('raw', k));
/** Lock `raw` so only the owner of `publicJwk` can open it */
export async function sealFor(publicJwk: string, raw: Uint8Array): Promise<string> {
  const pub = await subtle().importKey('jwk', JSON.parse(publicJwk), ECDH, false, []);
  const eph = await subtle().generateKey(ECDH, true, ['deriveKey']);
  const k = await subtle().deriveKey({ name: 'ECDH', public: pub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  return JSON.stringify({ epk: await subtle().exportKey('jwk', eph.publicKey), ct: await seal(k, raw) });
}
/** Open something locked with sealFor, using your private key */
export async function openSealed(privateKey: CryptoKey, sealed: string): Promise<Uint8Array> {
  const { epk, ct } = JSON.parse(sealed) as { epk: JsonWebKey; ct: string };
  const pub = await subtle().importKey('jwk', epk, ECDH, false, []);
  const k = await subtle().deriveKey({ name: 'ECDH', public: pub }, privateKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return unseal(k, ct);
}
export const importPrivateJwk = (jwk: JsonWebKey) => subtle().importKey('jwk', jwk, ECDH, false, ['deriveKey']);
/* invite links: the secret half lives only in the link (#…), never on the server */
export const b64url = (u: Uint8Array) => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
export const randomBytes = (n: number) => rand(n);
async function linkKey(secret: Uint8Array) { return subtle().importKey('raw', secret as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']); }
export const sealWithSecret = async (secret: Uint8Array, raw: Uint8Array) => seal(await linkKey(secret), raw);
export const openWithSecret = async (secret: Uint8Array, s: string) => unseal(await linkKey(secret), s);
