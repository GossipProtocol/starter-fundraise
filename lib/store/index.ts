import { memoryStore } from "./memory";
import { supabaseStore } from "./supabase";
import type { Store } from "./types";

export { StoreError } from "./types";
export type { Store, CommitInput, CommitResult, ReserveInput, UnmatchedPayment } from "./types";
export { DEMO_SLUG } from "./memory";

/** Demo mode until SUPABASE_URL is set. The switch is the only place
 *  that knows two stores exist. Server only. */
export function store(): Store {
  return process.env.SUPABASE_URL ? supabaseStore : memoryStore;
}
