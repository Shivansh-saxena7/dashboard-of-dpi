// 2026-11-23: PostgREST puts .in() lists in the URL. Tagging 655 new leads with one PATCH (~25.6K characters of ids)
// was refused by the API gateway with "400 Bad Request" (640 ids still passed); the import then stopped before
// giving the leads to anyone. Update in chunks instead: 200 ids is ~7.8K characters, far below the limit.
// Stops at the first failing chunk and returns its error (the caller reports the step as failed, as before).
export const ID_CHUNK = 200;

// deno-lint-ignore no-explicit-any
export async function updateInChunks(supabase: any, table: string, values: Record<string, unknown>, ids: string[], size: number = ID_CHUNK) {
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += size) {
    const { error } = await supabase.from(table).update(values).in("id", unique.slice(i, i + size));
    if (error) return error;
  }
  return null;
}
