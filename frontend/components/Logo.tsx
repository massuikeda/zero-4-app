/** ミエルMAP のロゴ（アイコン＋文字）。青い背景の上で使う反転版。 */

export function LogoIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="ミエルMAP">
      <rect width="64" height="64" rx="14" fill="#ffffff" />
      {/* 虫めがねの柄 */}
      <path d="M41 41 L52 52" stroke="#5fa3e0" strokeWidth="7" strokeLinecap="round" />
      {/* レンズ */}
      <circle cx="28" cy="28" r="17" fill="#dcebf9" stroke="#5fa3e0" strokeWidth="5" />
      {/* 地図の道（点線） */}
      <path
        d="M16 35 Q22 31 27 33 T40 22"
        fill="none"
        stroke="#5fa3e0"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="0.1 5"
      />
      {/* ピン */}
      <path
        d="M28 16.5 C23.6 16.5 20.5 19.7 20.5 23.8 C20.5 29 28 36 28 36 C28 36 35.5 29 35.5 23.8 C35.5 19.7 32.4 16.5 28 16.5 Z"
        fill="#24569a"
      />
      <circle cx="28" cy="23.6" r="2.9" fill="#dcebf9" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo-lockup">
      <LogoIcon />
      <span className="logo-text">
        <span className="logo-name">
          ミエル<span className="logo-map">MAP</span>
        </span>
        <span className="logo-sub">業務の見える化マップ</span>
      </span>
    </span>
  );
}
