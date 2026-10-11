/**
 * Brand mark: a water drop with a lightning bolt cut out of it (evenodd), so whatever sits
 * behind the mark (the flag-yellow block) shows through the bolt. Drawn on a 32×32 grid.
 */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M16 2.5C16 2.5 6 13.6 6 20.2a10 10 0 0 0 20 0C26 13.6 16 2.5 16 2.5Z
           M17.9 11.6 11.6 21.3h4.3l-1.3 7.1 6.6-10h-4.4l1.1-6.8Z"
      />
    </svg>
  );
}
