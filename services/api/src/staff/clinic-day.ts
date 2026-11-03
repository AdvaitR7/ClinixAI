/** Returns the clinic's IST calendar date, independent of the server's timezone. */
export function clinicDay(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}
