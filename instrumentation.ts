/* Runs once when the Next.js server starts. Live mode with the course fee
   recipient still set to the placeholder fails here, before the first
   request, instead of taking payments without the fee. */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertLiveConfig, mode } = await import("./lib/server/env");
  assertLiveConfig();
  console.log(`[starter-fundraise] ${mode()} mode`);
}
