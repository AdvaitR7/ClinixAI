/** Pulse skeleton block (DESIGN.md §7: skeletons, never spinners). */
export function Skeleton({ className = "h-12 rounded-xl" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse bg-hairline ${className}`} />;
}
