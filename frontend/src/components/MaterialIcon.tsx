type MaterialIconProps = {
  name: string;
  className?: string;
};

export function MaterialIcon({ name, className = "" }: MaterialIconProps) {
  return (
    <span className={`material-symbols-rounded ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}
