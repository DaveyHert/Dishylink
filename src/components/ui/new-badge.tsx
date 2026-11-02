import { cn } from "@/lib/utils";

export function NewBadge({ children, className }: { children: string; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-full bg-linear-to-r from-[#f0457f] to-[#fb8a3c] px-1.5 py-px text-[9.5px] font-semibold tracking-normal text-white normal-case",
        className,
      )}
    >
      {children}
    </span>
  );
}
