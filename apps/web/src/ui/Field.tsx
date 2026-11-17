import type { ComponentProps } from "react";

// A label that wraps its text and control, so the control is named by the label.
export function Field({ className, ...rest }: ComponentProps<"label">) {
  return (
    <label
      className={className ? `form-field ${className}` : "form-field"}
      {...rest}
    />
  );
}
