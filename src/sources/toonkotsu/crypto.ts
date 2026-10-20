import { NativeCrypto } from "@suwatte/toolchain";

import { READER_SECRET } from "./constants";
import { ReaderKeyResponse } from "./types";

declare const Crypto: NativeCrypto;

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const asciiBytes = (value: string): Uint8Array =>
  Uint8Array.from(value, (c) => c.charCodeAt(0));

/** Decodes base64 or base64url, with or without padding. */
export function decodeBase64Url(value: string): Uint8Array {
  const clean = value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) ||
    clean.length % 4 === 1 ||
    (value.includes("=") && value.length % 4 !== 0)
  ) {
    throw new Error("Invalid base64 reader data.");
  }
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const character of clean) {
    buffer = ((buffer << 6) | BASE64.indexOf(character)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  if (bits && buffer & ((1 << bits) - 1)) throw new Error("Invalid base64 reader data.");
  return bytes.subarray(0, index);
}

/** Encodes as unpadded base64url. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const length = Math.min(3, bytes.length - i) + 1;
    for (let j = 0; j < length; j++) out += BASE64[(chunk >> (18 - j * 6)) & 63];
  }
  return out;
}

const xorCycle = (data: Uint8Array, mask: Uint8Array): Uint8Array =>
  data.map((value, index) => value ^ mask[index % mask.length]);

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? Crypto.sha256(key) : key);
  const inner = new Uint8Array(64 + message.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }
  inner.set(message, 64);
  outer.set(Crypto.sha256(inner), 64);
  return Crypto.sha256(outer);
}

export interface ReaderKey {
  /** HMAC-SHA256 key that signs chapter requests and unwraps page keys. */
  key: Uint8Array;
  /** Server time minus local time, in milliseconds. */
  offset: number;
}

/** The served key is masked with a digest of the reader secret. */
export function deriveReaderKey(
  response: ReaderKeyResponse,
  secret = READER_SECRET
): ReaderKey {
  const mask = Crypto.sha256(asciiBytes(`sign:${secret}`));
  return {
    key: xorCycle(decodeBase64Url(response.key), mask),
    offset: Number(response.now) - Date.now() || 0,
  };
}

const hmac = (readerKey: ReaderKey, message: string): Uint8Array =>
  hmacSha256(readerKey.key, asciiBytes(message));

const randomBytes = (length: number): Uint8Array =>
  Uint8Array.from({ length }, () => Math.floor(Math.random() * 256));

/** Builds the `x-sig` header for a reader API path. */
export function signReaderPath(readerKey: ReaderKey, path: string): string {
  const time = String(Date.now() + readerKey.offset);
  const nonce = encodeBase64Url(randomBytes(12));
  const signature = encodeBase64Url(hmac(readerKey, `${time}.${nonce}.${path}`));
  return `v1.${time}.${nonce}.${signature.slice(0, 32)}`;
}

/** A "v1" wrapped chapter masks each page key with an HMAC of that page's nonce. */
export function unwrapPageKey(readerKey: ReaderKey, key: string, nonce: string): string {
  return encodeBase64Url(xorCycle(decodeBase64Url(key), hmac(readerKey, `page.${nonce}`)));
}

// ================================ AES-CTR ================================

const SBOX = new Uint8Array(256);
const MIX = [0, 1, 2, 3].map(() => new Int32Array(256));
// SBOX shifted into each byte of a word; FINAL[n] fills the nth byte in memory order.
const FINAL = [0, 1, 2, 3].map(() => new Int32Array(256));

{
  const double = Array.from({ length: 256 }, (_, i) => (i < 128 ? i << 1 : (i << 1) ^ 0x11b));
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  let x = 0;
  let xi = 0;
  for (let i = 0; i < 256; i++) {
    let sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4);
    sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63;
    SBOX[x] = sx;
    for (let n = 0; n < 4; n++) FINAL[n][x] = sx << (littleEndian ? n * 8 : 24 - n * 8);
    const x2 = double[x];
    const x8 = double[double[x2]];
    const t = (double[sx] * 0x101) ^ (sx * 0x1010100);
    MIX[0][x] = (t << 24) | (t >>> 8);
    MIX[1][x] = (t << 16) | (t >>> 16);
    MIX[2][x] = (t << 8) | (t >>> 24);
    MIX[3][x] = t;
    if (x === 0) {
      x = xi = 1;
    } else {
      x = x2 ^ double[double[double[x8 ^ x2]]];
      xi ^= double[double[xi]];
    }
  }
}

const RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

const subWord = (t: number): number =>
  (SBOX[t >>> 24] << 24) |
  (SBOX[(t >>> 16) & 0xff] << 16) |
  (SBOX[(t >>> 8) & 0xff] << 8) |
  SBOX[t & 0xff];

function expandKey(key: Uint8Array): Uint32Array {
  const words = key.length / 4;
  if (![4, 6, 8].includes(words)) throw new Error(`Unsupported page key length ${key.length}`);
  const schedule = new Uint32Array((words + 7) * 4);
  for (let i = 0; i < schedule.length; i++) {
    if (i < words) {
      schedule[i] =
        (key[i * 4] << 24) | (key[i * 4 + 1] << 16) | (key[i * 4 + 2] << 8) | key[i * 4 + 3];
      continue;
    }
    let t = schedule[i - 1];
    if (i % words === 0) {
      t = subWord((t << 8) | (t >>> 24)) ^ (RCON[i / words] << 24);
    } else if (words > 6 && i % words === 4) {
      t = subWord(t);
    }
    schedule[i] = schedule[i - words] ^ t;
  }
  return schedule;
}

/**
 * Pages are AES-CTR encrypted: the counter block is the first 8 bytes of the
 * page nonce followed by a 64-bit big-endian block counter. Suwatte's native
 * crypto only offers AES-CBC, so the keystream is generated here.
 *
 * JavaScriptCore runs sources without a JIT, so this loop is written for the
 * interpreter: tables and round keys live in locals, the AES rounds are
 * unrolled, and the keystream is applied a 32-bit word at a time. Only the
 * counter's low byte changes between neighbouring blocks, so most of the first
 * two rounds is computed once per run of 256 blocks.
 */
export function decryptPage(data: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array {
  if (nonce.length < 8) throw new Error("Invalid AES-CTR page nonce: fewer than 8 bytes.");
  const rk = new Int32Array(expandKey(key));
  const rounds = rk.length / 4 - 1;
  // Round keys past the first two rounds, as locals; missing ones belong to rounds not run.
  const r12 = rk[12] | 0, r13 = rk[13] | 0, r14 = rk[14] | 0, r15 = rk[15] | 0;
  const r16 = rk[16] | 0, r17 = rk[17] | 0, r18 = rk[18] | 0, r19 = rk[19] | 0;
  const r20 = rk[20] | 0, r21 = rk[21] | 0, r22 = rk[22] | 0, r23 = rk[23] | 0;
  const r24 = rk[24] | 0, r25 = rk[25] | 0, r26 = rk[26] | 0, r27 = rk[27] | 0;
  const r28 = rk[28] | 0, r29 = rk[29] | 0, r30 = rk[30] | 0, r31 = rk[31] | 0;
  const r32 = rk[32] | 0, r33 = rk[33] | 0, r34 = rk[34] | 0, r35 = rk[35] | 0;
  const r36 = rk[36] | 0, r37 = rk[37] | 0, r38 = rk[38] | 0, r39 = rk[39] | 0;
  const r40 = rk[40] | 0, r41 = rk[41] | 0, r42 = rk[42] | 0, r43 = rk[43] | 0;
  const r44 = rk[44] | 0, r45 = rk[45] | 0, r46 = rk[46] | 0, r47 = rk[47] | 0;
  const r48 = rk[48] | 0, r49 = rk[49] | 0, r50 = rk[50] | 0, r51 = rk[51] | 0;
  const r52 = rk[52] | 0, r53 = rk[53] | 0, r54 = rk[54] | 0, r55 = rk[55] | 0;
  const m0 = MIX[0];
  const m1 = MIX[1];
  const m2 = MIX[2];
  const m3 = MIX[3];
  const f0 = FINAL[0];
  const f1 = FINAL[1];
  const f2 = FINAL[2];
  const f3 = FINAL[3];
  // The last round key, rearranged into memory order like the FINAL tables.
  const last = new Int32Array(4);
  const lastView = new DataView(last.buffer);
  for (let i = 0; i < 4; i++) lastView.setInt32(i * 4, rk[rounds * 4 + i], false);
  const l0 = last[0];
  const l1 = last[1];
  const l2 = last[2];
  const l3 = last[3];

  const length = data.length;
  const bytes = new Uint8Array(length);
  bytes.set(data);
  const wordCount = length >>> 2;
  const words = new Int32Array(bytes.buffer, 0, wordCount);

  const c0 = ((nonce[0] << 24) | (nonce[1] << 16) | (nonce[2] << 8) | nonce[3]) ^ rk[0];
  const c1 = ((nonce[4] << 24) | (nonce[5] << 16) | (nonce[6] << 8) | nonce[7]) ^ rk[1];
  const blocks = Math.ceil(length / 16);
  // Round 1 terms that only depend on the fixed nonce words.
  const a0 = m0[c0 >>> 24] ^ m1[(c1 >>> 16) & 0xff] ^ rk[4];
  const a1 = m0[c1 >>> 24] ^ m3[c0 & 0xff] ^ rk[5];
  const a2 = m2[(c0 >>> 8) & 0xff] ^ m3[c1 & 0xff] ^ rk[6];
  const a3 = m1[(c0 >>> 16) & 0xff] ^ m2[(c1 >>> 8) & 0xff] ^ rk[7];

  let c2 = 0;
  let r0 = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let t0 = 0;
  let t1 = 0;
  let t2 = 0;
  for (let block = 0, w = 0; block < blocks; block++, w += 4) {
    const c3 = block ^ rk[3];
    if (block === 0 || (block & 0xff) === 0) {
      // Everything except the counter's low byte is fixed for the next 256 blocks.
      c2 = Math.floor(block / 0x100000000) ^ rk[2];
      r0 = a0 ^ m2[(c2 >>> 8) & 0xff];
      const t1 = a1 ^ m1[(c2 >>> 16) & 0xff] ^ m2[(c3 >>> 8) & 0xff];
      const t2 = a2 ^ m0[c2 >>> 24] ^ m1[(c3 >>> 16) & 0xff];
      const t3 = a3 ^ m0[c3 >>> 24] ^ m3[c2 & 0xff];
      b0 = m1[(t1 >>> 16) & 0xff] ^ m2[(t2 >>> 8) & 0xff] ^ m3[t3 & 0xff] ^ rk[8];
      b1 = m0[t1 >>> 24] ^ m1[(t2 >>> 16) & 0xff] ^ m2[(t3 >>> 8) & 0xff] ^ rk[9];
      b2 = m0[t2 >>> 24] ^ m1[(t3 >>> 16) & 0xff] ^ m3[t1 & 0xff] ^ rk[10];
      b3 = m0[t3 >>> 24] ^ m2[(t1 >>> 8) & 0xff] ^ m3[t2 & 0xff] ^ rk[11];
    }
    const x0 = r0 ^ m3[c3 & 0xff];
    let s0 = b0 ^ m0[x0 >>> 24];
    let s1 = b1 ^ m3[x0 & 0xff];
    let s2 = b2 ^ m2[(x0 >>> 8) & 0xff];
    let s3 = b3 ^ m1[(x0 >>> 16) & 0xff];
    t0 = m0[s0 >>> 24] ^ m1[(s1 >>> 16) & 0xff] ^ m2[(s2 >>> 8) & 0xff] ^ m3[s3 & 0xff] ^ r12;
    t1 = m0[s1 >>> 24] ^ m1[(s2 >>> 16) & 0xff] ^ m2[(s3 >>> 8) & 0xff] ^ m3[s0 & 0xff] ^ r13;
    t2 = m0[s2 >>> 24] ^ m1[(s3 >>> 16) & 0xff] ^ m2[(s0 >>> 8) & 0xff] ^ m3[s1 & 0xff] ^ r14;
    s3 = m0[s3 >>> 24] ^ m1[(s0 >>> 16) & 0xff] ^ m2[(s1 >>> 8) & 0xff] ^ m3[s2 & 0xff] ^ r15;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    t0 = m0[s0 >>> 24] ^ m1[(s1 >>> 16) & 0xff] ^ m2[(s2 >>> 8) & 0xff] ^ m3[s3 & 0xff] ^ r16;
    t1 = m0[s1 >>> 24] ^ m1[(s2 >>> 16) & 0xff] ^ m2[(s3 >>> 8) & 0xff] ^ m3[s0 & 0xff] ^ r17;
    t2 = m0[s2 >>> 24] ^ m1[(s3 >>> 16) & 0xff] ^ m2[(s0 >>> 8) & 0xff] ^ m3[s1 & 0xff] ^ r18;
    s3 = m0[s3 >>> 24] ^ m1[(s0 >>> 16) & 0xff] ^ m2[(s1 >>> 8) & 0xff] ^ m3[s2 & 0xff] ^ r19;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    t0 = m0[s0 >>> 24] ^ m1[(s1 >>> 16) & 0xff] ^ m2[(s2 >>> 8) & 0xff] ^ m3[s3 & 0xff] ^ r20;
    t1 = m0[s1 >>> 24] ^ m1[(s2 >>> 16) & 0xff] ^ m2[(s3 >>> 8) & 0xff] ^ m3[s0 & 0xff] ^ r21;
    t2 = m0[s2 >>> 24] ^ m1[(s3 >>> 16) & 0xff] ^ m2[(s0 >>> 8) & 0xff] ^ m3[s1 & 0xff] ^ r22;
    s3 = m0[s3 >>> 24] ^ m1[(s0 >>> 16) & 0xff] ^ m2[(s1 >>> 8) & 0xff] ^ m3[s2 & 0xff] ^ r23;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    t0 = m0[s0 >>> 24] ^ m1[(s1 >>> 16) & 0xff] ^ m2[(s2 >>> 8) & 0xff] ^ m3[s3 & 0xff] ^ r24;
    t1 = m0[s1 >>> 24] ^ m1[(s2 >>> 16) & 0xff] ^ m2[(s3 >>> 8) & 0xff] ^ m3[s0 & 0xff] ^ r25;
    t2 = m0[s2 >>> 24] ^ m1[(s3 >>> 16) & 0xff] ^ m2[(s0 >>> 8) & 0xff] ^ m3[s1 & 0xff] ^ r26;
    s3 = m0[s3 >>> 24] ^ m1[(s0 >>> 16) & 0xff] ^ m2[(s1 >>> 8) & 0xff] ^ m3[s2 & 0xff] ^ r27;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    t0 = m0[s0 >>> 24] ^ m1[(s1 >>> 16) & 0xff] ^ m2[(s2 >>> 8) & 0xff] ^ m3[s3 & 0xff] ^ r28;
    t1 = m0[s1 >>> 24] ^ m1[(s2 >>> 16) & 0xff] ^ m2[(s3 >>> 8) & 0xff] ^ m3[s0 & 0xff] ^ r29;
    t2 = m0[s2 >>> 24] ^ m1[(s3 >>> 16) & 0xff] ^ m2[(s0 >>> 8) & 0xff] ^ m3[s1 & 0xff] ^ r30;
    s3 = m0[s3 >>> 24] ^ m1[(s0 >>> 16) & 0xff] ^ m2[(s1 >>> 8) & 0xff] ^ m3[s2 & 0xff] ^ r31;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    t0 = m0[s0 >>> 24] ^ m1[(s1 >>> 16) & 0xff] ^ m2[(s2 >>> 8) & 0xff] ^ m3[s3 & 0xff] ^ r32;
    t1 = m0[s1 >>> 24] ^ m1[(s2 >>> 16) & 0xff] ^ m2[(s3 >>> 8) & 0xff] ^ m3[s0 & 0xff] ^ r33;
    t2 = m0[s2 >>> 24] ^ m1[(s3 >>> 16) & 0xff] ^ m2[(s0 >>> 8) & 0xff] ^ m3[s1 & 0xff] ^ r34;
    s3 = m0[s3 >>> 24] ^ m1[(s0 >>> 16) & 0xff] ^ m2[(s1 >>> 8) & 0xff] ^ m3[s2 & 0xff] ^ r35;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    t0 = m0[s0 >>> 24] ^ m1[(s1 >>> 16) & 0xff] ^ m2[(s2 >>> 8) & 0xff] ^ m3[s3 & 0xff] ^ r36;
    t1 = m0[s1 >>> 24] ^ m1[(s2 >>> 16) & 0xff] ^ m2[(s3 >>> 8) & 0xff] ^ m3[s0 & 0xff] ^ r37;
    t2 = m0[s2 >>> 24] ^ m1[(s3 >>> 16) & 0xff] ^ m2[(s0 >>> 8) & 0xff] ^ m3[s1 & 0xff] ^ r38;
    s3 = m0[s3 >>> 24] ^ m1[(s0 >>> 16) & 0xff] ^ m2[(s1 >>> 8) & 0xff] ^ m3[s2 & 0xff] ^ r39;
    s0 = t0;
    s1 = t1;
    s2 = t2;
    if (rounds > 10) {
      t0 = m0[s0 >>> 24] ^ m1[(s1 >>> 16) & 0xff] ^ m2[(s2 >>> 8) & 0xff] ^ m3[s3 & 0xff] ^ r40;
      t1 = m0[s1 >>> 24] ^ m1[(s2 >>> 16) & 0xff] ^ m2[(s3 >>> 8) & 0xff] ^ m3[s0 & 0xff] ^ r41;
      t2 = m0[s2 >>> 24] ^ m1[(s3 >>> 16) & 0xff] ^ m2[(s0 >>> 8) & 0xff] ^ m3[s1 & 0xff] ^ r42;
      s3 = m0[s3 >>> 24] ^ m1[(s0 >>> 16) & 0xff] ^ m2[(s1 >>> 8) & 0xff] ^ m3[s2 & 0xff] ^ r43;
      s0 = t0;
      s1 = t1;
      s2 = t2;
      t0 = m0[s0 >>> 24] ^ m1[(s1 >>> 16) & 0xff] ^ m2[(s2 >>> 8) & 0xff] ^ m3[s3 & 0xff] ^ r44;
      t1 = m0[s1 >>> 24] ^ m1[(s2 >>> 16) & 0xff] ^ m2[(s3 >>> 8) & 0xff] ^ m3[s0 & 0xff] ^ r45;
      t2 = m0[s2 >>> 24] ^ m1[(s3 >>> 16) & 0xff] ^ m2[(s0 >>> 8) & 0xff] ^ m3[s1 & 0xff] ^ r46;
      s3 = m0[s3 >>> 24] ^ m1[(s0 >>> 16) & 0xff] ^ m2[(s1 >>> 8) & 0xff] ^ m3[s2 & 0xff] ^ r47;
      s0 = t0;
      s1 = t1;
      s2 = t2;
      if (rounds > 12) {
        t0 = m0[s0 >>> 24] ^ m1[(s1 >>> 16) & 0xff] ^ m2[(s2 >>> 8) & 0xff] ^ m3[s3 & 0xff] ^ r48;
        t1 = m0[s1 >>> 24] ^ m1[(s2 >>> 16) & 0xff] ^ m2[(s3 >>> 8) & 0xff] ^ m3[s0 & 0xff] ^ r49;
        t2 = m0[s2 >>> 24] ^ m1[(s3 >>> 16) & 0xff] ^ m2[(s0 >>> 8) & 0xff] ^ m3[s1 & 0xff] ^ r50;
        s3 = m0[s3 >>> 24] ^ m1[(s0 >>> 16) & 0xff] ^ m2[(s1 >>> 8) & 0xff] ^ m3[s2 & 0xff] ^ r51;
        s0 = t0;
        s1 = t1;
        s2 = t2;
        t0 = m0[s0 >>> 24] ^ m1[(s1 >>> 16) & 0xff] ^ m2[(s2 >>> 8) & 0xff] ^ m3[s3 & 0xff] ^ r52;
        t1 = m0[s1 >>> 24] ^ m1[(s2 >>> 16) & 0xff] ^ m2[(s3 >>> 8) & 0xff] ^ m3[s0 & 0xff] ^ r53;
        t2 = m0[s2 >>> 24] ^ m1[(s3 >>> 16) & 0xff] ^ m2[(s0 >>> 8) & 0xff] ^ m3[s1 & 0xff] ^ r54;
        s3 = m0[s3 >>> 24] ^ m1[(s0 >>> 16) & 0xff] ^ m2[(s1 >>> 8) & 0xff] ^ m3[s2 & 0xff] ^ r55;
        s0 = t0;
        s1 = t1;
        s2 = t2;
      }
    }
    const o0 =
      f0[s0 >>> 24] ^ f1[(s1 >>> 16) & 0xff] ^ f2[(s2 >>> 8) & 0xff] ^ f3[s3 & 0xff] ^ l0;
    const o1 =
      f0[s1 >>> 24] ^ f1[(s2 >>> 16) & 0xff] ^ f2[(s3 >>> 8) & 0xff] ^ f3[s0 & 0xff] ^ l1;
    const o2 =
      f0[s2 >>> 24] ^ f1[(s3 >>> 16) & 0xff] ^ f2[(s0 >>> 8) & 0xff] ^ f3[s1 & 0xff] ^ l2;
    const o3 =
      f0[s3 >>> 24] ^ f1[(s0 >>> 16) & 0xff] ^ f2[(s1 >>> 8) & 0xff] ^ f3[s2 & 0xff] ^ l3;

    if (w + 4 <= wordCount) {
      words[w] ^= o0;
      words[w + 1] ^= o1;
      words[w + 2] ^= o2;
      words[w + 3] ^= o3;
    } else {
      const stream = new Uint8Array(new Int32Array([o0, o1, o2, o3]).buffer);
      for (let i = block * 16; i < length; i++) bytes[i] ^= stream[i - block * 16];
    }
  }
  return bytes;
}
