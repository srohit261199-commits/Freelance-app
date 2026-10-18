/** The app's mark: an isometric cube in three tones of teal (the same drawing as build/logo.svg). */
export function Logo({ size = 22, className = 'mark' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M32 6 L54 18.7 L32 31.4 L10 18.7 Z" fill="#5CC8BA" />
      <path d="M10 18.7 L32 31.4 L32 58 L10 45.3 Z" fill="#14857A" />
      <path d="M54 18.7 L54 45.3 L32 58 L32 31.4 Z" fill="#0B5F58" />
    </svg>
  );
}
