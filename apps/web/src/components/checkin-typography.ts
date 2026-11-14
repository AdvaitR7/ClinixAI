/**
 * Check-in typography. The route-local Inter and Playfair loads were removed: Inter is now loaded once
 * at the root, so this only keeps the exported class string (and its serif override) pointing at it.
 */
export const checkinTypography = "font-sans [&_.font-serif]:font-sans";
