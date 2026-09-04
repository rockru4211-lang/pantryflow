type DaisyLogoProps = {
  className?: string;
  title?: string;
};

export default function DaisyLogo({ className = "daisy-mark", title }: DaisyLogoProps) {
  return (
    <svg
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {title && <title>{title}</title>}
      <circle cx="32" cy="32" r="29" />
      <circle cx="32" cy="32" r="24" opacity=".6" />
      <ellipse cx="32" cy="18" rx="5.5" ry="10.5" />
      {[45, 90, 135, 180, 225, 270, 315].map(angle => (
        <ellipse key={angle} cx="32" cy="18" rx="5.5" ry="10.5" transform={`rotate(${angle} 32 32)`} />
      ))}
      <circle cx="32" cy="32" r="5" fill="white" />
    </svg>
  );
}
