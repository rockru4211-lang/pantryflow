const svg=(body,className='ui-icon')=>`<svg class="${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const icons={
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  warning:'<path d="m21 19-9-16-9 16h18Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  calendarClock:'<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h7"/><circle cx="16" cy="16" r="4"/><path d="M16 14v2l1.5 1"/>',
  help:'<circle cx="12" cy="12" r="10"/><path d="M9.5 9a3 3 0 1 1 4.9 2.3c-.9.7-1.4 1.1-1.4 2.2"/><path d="M12 17h.01"/>',
  clipboard:'<rect width="16" height="18" x="4" y="3" rx="2"/><path d="M9 3V2h6v1M9 8h6M9 12h6M9 16h4"/>',
  truck:'<path d="M10 17h4V5H2v12h3"/><path d="M14 9h4l4 4v4h-3"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5"/>',
  more:'<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  home:'<path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-6h6v6"/>',
  activity:'<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  tasks:'<path d="m9 11 2 2 4-5"/><path d="M21 12a9 9 0 1 1-5.3-8.2"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield:'<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"/><path d="m9 12 2 2 4-4"/>',
  arrowRight:'<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  package:'<path d="m16.5 9.4-9-5.2M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  chart:'<path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/>',
  fileText:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  building:'<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  sliders:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  lock:'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
};

export function icon(name,className='ui-icon'){return svg(icons[name]||icons.help,className)}

export const daisyMark=`<svg class="daisy-mark" aria-hidden="true" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="32" cy="32" r="29"/><g><ellipse cx="32" cy="16" rx="5" ry="11"/><ellipse cx="32" cy="48" rx="5" ry="11"/><ellipse cx="16" cy="32" rx="11" ry="5"/><ellipse cx="48" cy="32" rx="11" ry="5"/><ellipse cx="20.7" cy="20.7" rx="5" ry="11" transform="rotate(-45 20.7 20.7)"/><ellipse cx="43.3" cy="43.3" rx="5" ry="11" transform="rotate(-45 43.3 43.3)"/><ellipse cx="43.3" cy="20.7" rx="11" ry="5" transform="rotate(-45 43.3 20.7)"/><ellipse cx="20.7" cy="43.3" rx="11" ry="5" transform="rotate(-45 20.7 43.3)"/></g><circle cx="32" cy="32" r="7"/></svg>`;
