import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export interface SigningKey {
  /** 32-byte Ed25519 seed, hex. */
  seed: string;
  /** 32-byte public key, hex. */
  publicKey: string;
}

export function generateSeedHex(): string {
  return bytesToHex(ed.utils.randomPrivateKey());
}

export async function signingKeyFromSeed(seedHex: string): Promise<SigningKey> {
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) throw new Error("Ed25519 seed must be 64 hex characters");
  const seed = seedHex.toLowerCase();
  return { seed, publicKey: bytesToHex(await ed.getPublicKeyAsync(hexToBytes(seed))) };
}

export async function signBytes(message: Uint8Array, key: SigningKey): Promise<string> {
  return bytesToHex(await ed.signAsync(message, hexToBytes(key.seed)));
}

export async function verifyBytes(signatureHex: string, message: Uint8Array, publicKeyHex: string): Promise<boolean> {
  try {
    return await ed.verifyAsync(hexToBytes(signatureHex), message, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}
