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
  // `loading` must be destructured (never spread onto <button>) — React warns
  // about a non-boolean `loading` DOM attribute otherwise. While loading, the
  // spinner replaces the left icon (so the label stays put and the button
  // doesn't change width) and the button is disabled, which is what stops a
  // second click landing on an in-flight payment or integration push.
  loading = false,
  disabled = false,
  ...rest
}) {
  const cls = [
    "btn",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : "",
    !children ? "btn-icon" : "",
    fullWidth ? "btn-full" : "",
    loading ? "btn-loading" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const leading = loading ? (
    <span
      className="spinner"
      style={{ "--sp-size": size === "sm" ? "12px" : "14px", borderWidth: "2px" }}
      aria-hidden="true"
    />
  ) : (
    icon && <Icon name={icon} />
  );

  return (
    <button
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {leading}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  );
}
