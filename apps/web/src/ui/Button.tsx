import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "icon";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "primary-button",
  secondary: "secondary-button",
  icon: "icon-button",
};

type ButtonProps = ComponentProps<"button"> & { variant?: Variant };

// Renders a plain <button>. It deliberately sets no default `type`, so existing
// form-submit behavior is unchanged.
export function Button({
  variant = "secondary",
  className,
  ...rest
}: ButtonProps) {
  const base = VARIANT_CLASS[variant];
  return (
    <button className={className ? `${base} ${className}` : base} {...rest} />
  );
}
