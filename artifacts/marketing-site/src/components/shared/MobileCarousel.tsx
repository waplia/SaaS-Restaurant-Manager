import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  itemWidth?: string;
  className?: string;
  hideOnDesktop?: boolean;
  "data-testid"?: string;
}

/**
 * Horizontal snap carousel for mobile. Renders children in a horizontally
 * scrollable row with snap behavior. Use `itemWidth` Tailwind class for
 * each direct child's basis (e.g. "w-[78%]").
 */
export function MobileCarousel({
  children,
  className = "",
  hideOnDesktop = false,
  ...rest
}: Props) {
  return (
    <div
      data-testid={rest["data-testid"]}
      className={`flex gap-3 overflow-x-auto no-scrollbar scroll-snap-x px-4 -mx-4 pb-2 ${
        hideOnDesktop ? "md:hidden" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CarouselItem({ children, width = "w-[78%] sm:w-[55%]", className = "" }: { children: ReactNode; width?: string; className?: string }) {
  return (
    <div className={`shrink-0 snap-card ${width} ${className}`}>{children}</div>
  );
}
