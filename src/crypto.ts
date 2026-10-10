// AES-GCM with a PBKDF2 key from the passphrase: salt(16) | iv(12) | ciphertext.
// Project files land in a public repo, so they are encrypted on the device.
const ITER = 310_000

// WebCrypto wants ArrayBuffer-backed views; subarray() keeps the parent buffer type.
const buf = (u: Uint8Array) => u.slice().buffer as ArrayBuffer

async function key(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', buf(new TextEncoder().encode(pass)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: buf(salt), iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encrypt(bytes: Uint8Array, pass: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const k = await key(pass, salt)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, k, buf(bytes)))
  const out = new Uint8Array(28 + ct.length)
  out.set(salt, 0)
  out.set(iv, 16)
  out.set(ct, 28)
  return out
}

export async function decrypt(data: Uint8Array, pass: string): Promise<Uint8Array> {
  const k = await key(pass, data.subarray(0, 16))
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(data.subarray(16, 28)) }, k, buf(data.subarray(28))))
  } catch {
    throw new Error('Kriva lozinka za šifriranje')
  }
}
