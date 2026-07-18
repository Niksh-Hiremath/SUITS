const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function sha256HexToBase64(value: string): string {
  if (!SHA256_HEX_PATTERN.test(value)) throw new Error("STORAGE_SHA256_HEX_INVALID");
  const bytes = Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += BASE64_ALPHABET.charAt((combined >>> 18) & 0x3f);
    encoded += BASE64_ALPHABET.charAt((combined >>> 12) & 0x3f);
    encoded += second === undefined ? "=" : BASE64_ALPHABET.charAt((combined >>> 6) & 0x3f);
    encoded += third === undefined ? "=" : BASE64_ALPHABET.charAt(combined & 0x3f);
  }
  return encoded;
}

/**
 * Convex deployments have exposed `_storage.sha256` as either lowercase
 * base16 (documented) or padded base64 (observed). Accept only exact encodings
 * of the expected digest so the integrity check stays strict across runtimes.
 */
export function storedSha256Matches(storedValue: string, expectedHex: string): boolean {
  if (!SHA256_HEX_PATTERN.test(expectedHex)) return false;
  const expectedBase64 = sha256HexToBase64(expectedHex);
  return storedValue === expectedHex ||
    storedValue === expectedBase64 ||
    storedValue === expectedBase64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
