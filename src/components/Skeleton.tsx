export default function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-md bg-current opacity-10 motion-safe:animate-pulse ${className}`}
    />
  );
}
export function TextSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="mt-3 space-y-3">
      <Skeleton />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
export function MapSkeleton() {
  return (
    <div role="status" aria-label="Loading map">
      <Skeleton className="h-[480px] w-full rounded-[16px]" />
    </div>
  );
}
