/**
 * Minimal className combiner. Kept dependency-free (no clsx/tailwind-merge) per
 * the brief's "no unnecessary dependencies" rule.
 */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(' ');
}
