/** Stroke paths on a 24x24 grid, one entry per approved Clear icon. Add a name here before using it. */
const ICON_PATHS = {
  plus: "M12 5v14M5 12h14",
  back: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  home: "M4 11l8-7 8 7M6 10v9h12v-9",
  calendar: "M5 6h14v13H5zM5 10h14M9 4v4M15 4v4",
  clock: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 8v4.5l3 1.5",
  file: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  pill: "M9 4.5a4.2 4.2 0 0 1 6 6l-4.5 4.5a4.2 4.2 0 0 1-6-6zM7.5 12l4.5-4.5",
  shield: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z",
  bell: "M6 17h12l-1.5-2.5V10a4.5 4.5 0 0 0-9 0v4.5zM10 20h4",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20c.7-3.4 3.5-5 7-5s6.3 1.6 7 5",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 19c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5M16 5a3.2 3.2 0 0 1 0 6M18 15c1.8.5 2.8 1.8 3 4",
  alert: "M12 4l9 16H3zM12 10v4M12 17v.5",
} as const;

export type UiIconName = keyof typeof ICON_PATHS;

interface UiIconProps {
  name: UiIconName;
  /** Pixel size for both axes. Defaults to 20, the dock size in the approved design. */
  size?: number;
  /** Accessible name. Omit for decorative icons next to a visible label; they are then hidden from assistive tech. */
  label?: string;
  className?: string;
}

/**
 * Presentational inline SVG using currentColor, so the parent's text colour sets the icon colour.
 * It never owns behaviour: an icon-only control must carry its own accessible name, or pass `label` here.
 */
export function UiIcon({ name, size = 20, label, className }: UiIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
