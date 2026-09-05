export const icons = {
  'chevron-down': '<path d="m6 9 6 6 6-6" />',
  'chevron-left': '<path d="m15 18-6-6 6-6" />',
  'chevron-right': '<path d="m9 18 6-6-6-6" />',
  'triangle-up': '<path d="M12 7 5 17h14L12 7Z" fill="currentColor" stroke="none" />',
  'triangle-down': '<path d="M12 17 5 7h14l-7 10Z" fill="currentColor" stroke="none" />',
  close: '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
  search: '<circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" />',
  'search-alt': '<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />',
  check: '<path d="M20 6 9 17l-5-5" />',
  shuffle:
    '<path d="m18 14 4 4-4 4" /><path d="m18 2 4 4-4 4" /><path d="M2 18h1.8a8 8 0 0 0 6.5-3.3l3.4-4.8A8 8 0 0 1 20.2 6H22" /><path d="M2 6h1.8a8 8 0 0 1 6.5 3.3l.7 1" /><path d="M14 16.5a8 8 0 0 0 6.2 1.5H22" />',
  sun: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />',
  'arrow-down-up': '<path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" />'
} as const;

export type IconName = keyof typeof icons;
