import { COUNTRY_NAMES } from "./country-codes";

/** Short English country name for an ISO 3166-1 alpha-2 code; falls back to the code itself. */
export function countryName(code: string): string {
  const upper = code.toUpperCase();
  return COUNTRY_NAMES[upper] ?? upper;
}

/** Regional-indicator flag emoji for an alpha-2 code. */
export function countryFlag(code: string): string {
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "";
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
