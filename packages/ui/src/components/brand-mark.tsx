import { cn } from "../lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("shrink-0", className)}
      fill="none"
      strokeLinecap="round"
      viewBox="10 10 44 44"
    >
      <path
        className="stroke-[#43315d] dark:stroke-[#f0dfff]"
        d="M36.5 43 21.2 27.7c-3.8-3.8-1.5-9.8 3.8-9.8 5.2 0 7.9 6.3 3 9.5l-7.9 5.1c-5.8 3.8-4.5 12.2 2.3 13 4.9.6 8.1-2 13.6-9.1"
        strokeLinejoin="round"
        strokeWidth={4.5}
      />
      <path
        className="stroke-[#79589a] dark:stroke-[#c9aae7]"
        d="M42 27h8m-8 9h8"
        strokeWidth={4}
      />
    </svg>
  );
}
