import type { ComponentProps } from "react";

type EmptyStateProps = ComponentProps<"div"> & { as?: "div" | "section" };

export function EmptyState({
  as: Tag = "div",
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <Tag
      className={className ? `empty-state ${className}` : "empty-state"}
      {...rest}
    />
  );
}
