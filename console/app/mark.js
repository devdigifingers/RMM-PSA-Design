export function Wordmark({ id = "df" }) {
  const steel = `${id}-steel`;
  const shine = `${id}-shine`;
  return (
    <svg className="wordmark" viewBox="0 0 400 68" role="img" aria-label="Digital Fingers">
      <defs>
        <linearGradient id={steel} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d5e0ea" />
          <stop offset="14%" stopColor="#ffffff" />
          <stop offset="28%" stopColor="#8ea0b3" />
          <stop offset="40%" stopColor="#ffffff" />
          <stop offset="48%" stopColor="#ffffff" />
          <stop offset="58%" stopColor="#6e8092" />
          <stop offset="74%" stopColor="#f5f8fb" />
          <stop offset="88%" stopColor="#24303c" />
          <stop offset="100%" stopColor="#e7eef4" />
        </linearGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="0" y2="1">
          <stop offset="30%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="42%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <text
        x="2"
        y="52.8"
        fill="#1a222c"
        fontFamily="inherit"
        fontSize="50"
        fontWeight="600"
        letterSpacing="-1.1"
      >
        Digital Fingers
      </text>
      <text
        x="2"
        y="52"
        fill={`url(#${steel})`}
        fontFamily="inherit"
        fontSize="50"
        fontWeight="600"
        letterSpacing="-1.1"
      >
        Digital Fingers
      </text>
      <text
        x="2"
        y="52"
        fill={`url(#${shine})`}
        fontFamily="inherit"
        fontSize="50"
        fontWeight="600"
        letterSpacing="-1.1"
      >
        Digital Fingers
      </text>
    </svg>
  );
}
