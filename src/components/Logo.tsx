/** Play triangle over four audio bars: video + music, the two things this studio makes. */
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="VideoStudioOM 로고">
      <defs>
        <linearGradient id="vsom-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c7cf0" />
          <stop offset="1" stopColor="#4a4ac8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#vsom-logo)" />
      <path d="M12 7.5v11l9-5.5z" fill="#fff" />
      <rect x="8" y="22.5" width="2.6" height="4" rx="1.3" fill="#fff" opacity=".9" />
      <rect x="12.6" y="20.5" width="2.6" height="6" rx="1.3" fill="#fff" opacity=".9" />
      <rect x="17.2" y="21.5" width="2.6" height="5" rx="1.3" fill="#fff" opacity=".9" />
      <rect x="21.8" y="23.5" width="2.6" height="3" rx="1.3" fill="#fff" opacity=".9" />
    </svg>
  );
}
