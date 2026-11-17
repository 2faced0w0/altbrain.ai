import type { ComponentProps } from "react";

type BannerProps = ComponentProps<"div"> & { as?: "div" | "p" };

// Error banner. It is announced to screen readers as an alert unless a
// different role is passed.
export function Banner({
  as: Tag = "div",
  role = "alert",
  className,
  ...rest
}: BannerProps) {
  return (
    <Tag
      role={role}
      className={className ? `error-banner ${className}` : "error-banner"}
      {...rest}
    />
  );
}
