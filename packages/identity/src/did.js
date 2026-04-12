import { webcrypto } from 'node:crypto'

/**
 * Erstellt ein einfaches did:key aus einem Ed25519-Keypair.
 * Basis für spätere UCAN-Integration.
 */
export async function createDID() {
  const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  )

  const pubBytes = new Uint8Array(
    await webcrypto.subtle.exportKey('raw', publicKey),
  )

  // did:key Multicodec-Prefix für Ed25519: 0xed01
  const prefixed = new Uint8Array([0xed, 0x01, ...pubBytes])
  const b64 = Buffer.from(prefixed).toString('base64url')
  const did = `did:key:z${b64}`

  return { did, publicKey, privateKey }
}
