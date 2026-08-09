import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, with later Tailwind utilities beating earlier ones of the
 * same kind. Without this, a `className` prop passed into a component would sit
 * alongside the component's own classes and lose to whichever CSS rule happened
 * to be declared later.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
