/** Unit tests implement only the external API members exercised by each case.
 * Keep the assertion at the fixture boundary, rather than disabling checking. */
export function stub<T>(implementation: unknown): T {
  return implementation as T;
}
