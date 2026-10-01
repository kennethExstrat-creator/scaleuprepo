/** True when `pathname` is `href` or (unless `exact`) a page below it. */
export function isNavActive(pathname: string, href: string, exact = false): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Active-item styling shared by the admin and portal sidebars (ScaleUp orange accent). */
export const ACTIVE_NAV_CLASSES =
  "data-active:bg-primary/10 data-active:text-foreground data-active:[&_svg]:text-primary";
