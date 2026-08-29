export { cn } from './lib/cn';

export { Button, buttonVariants, type ButtonProps } from './components/button';
export { Badge, VerifiedBadge, badgeVariants, type BadgeProps } from './components/badge';
export { Input, type InputProps } from './components/input';
export { Select, type SelectProps } from './components/select';
export { Textarea, type TextareaProps } from './components/textarea';
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './components/card';
export { Skeleton, SkeletonText } from './components/skeleton';
export { EmptyState, type EmptyStateProps } from './components/empty-state';
export {
  AIDisclaimer,
  TAX_DISCLAIMER_TEXT,
  VALUATION_DISCLAIMER_TEXT,
  type AIDisclaimerProps,
  type AIDisclaimerVariant,
} from './components/ai-disclaimer';

/*
 * The raw palette, for the rare context that has no stylesheet.
 *
 * Components must use semantic roles — `bg-surface`, `text-muted` — which
 * resolve through CSS variables and are correct in both themes. This export is
 * for the places where that machinery does not exist: `ImageResponse` renders
 * social cards in an isolated Satori context with no CSS at all, so a token
 * there resolves to nothing and produces a black rectangle.
 *
 * Reaching for this inside a component is a mistake; it hard-codes one theme.
 */
export { palette, type Palette, type PaletteFamily } from './tokens/primitives';

export { Tabs, type TabDefinition } from './components/tabs';

/*
 * Charts.
 *
 * Server-rendered inline SVG and CSS — no charting library, no client
 * component. The marks follow one spec across every chart in the product, and
 * the arithmetic behind the axes lives in `charts/scale.ts` where it is tested
 * directly rather than inferred from a screenshot.
 */
export { ColumnChart, ChartTable, type ChartPoint } from './charts/column-chart';
export { BarChart } from './charts/bar-chart';
export { StatTile } from './charts/stat-tile';
export { axisFor, compact, percentChange, type Axis } from './charts/scale';
