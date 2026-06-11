// Button.jsx — design-system button. Variants: primary | secondary | ghost | danger.
import Icon from "./Icon.jsx";

export default function Button({
  variant = "secondary",
  size,
  icon,
  iconRight,
  children,
  className = "",
  fullWidth = false,
  ...rest
}) {
  const cls = [
    "btn",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : "",
    !children ? "btn-icon" : "",
    fullWidth ? "btn-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={cls} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  );
}
