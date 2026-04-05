/**
 * Optimistic UI rows may use `crypto.randomUUID()` as a stand-in `_id` before
 * the Convex mutation returns a real document id. Those strings are UUID-shaped
 * and must not be sent to Convex or opened as real file tabs.
 */
export function isTemporaryOptimisticFileId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
}
