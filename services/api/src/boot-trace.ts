/**
 * Temporary boot tracer for diagnosing a silent Vercel cold-start hang.
 *
 * Imported first by index.ts, so its "modules loading" line is printed before any other module
 * evaluates. `bootTrace` marks later phases. Writes to stderr, which is unbuffered, so lines survive
 * the process being killed by the platform's startup timeout.
 */
const started = Date.now();
console.error(`[boot] modules loading (pid ${process.pid})`);

/**
 * Logs a named boot phase with milliseconds elapsed since the process began loading modules.
 *
 * @param phase - Short label for the step that just completed.
 */
export function bootTrace(phase: string): void {
  console.error(`[boot] ${phase} +${Date.now() - started}ms`);
}
