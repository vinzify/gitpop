type IconName =
  'branch' | 'folder' | 'refresh' | 'settings' | 'arrow' | 'spark' | 'check' | 'close' | 'search';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    branch: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="6" cy="19" r="2" />
        <circle cx="18" cy="5" r="2" />
        <path d="M6 7v10M18 7a8 8 0 0 1-8 8H6" />
      </>
    ),
    folder: <path d="M3 7V5h6l2 2h10v13H3ZM3 10h18" />,
    refresh: (
      <>
        <path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    arrow: <path d="M12 20V4m-6 6 6-6 6 6" />,
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
