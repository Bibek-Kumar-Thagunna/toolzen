import type { IconName } from '@/components/icons';

export type CategoryId = 'image' | 'pdf' | 'text' | 'developer' | 'calculators' | 'generators';

/**
 * Where the work happens. This drives the privacy badge shown on the tool page,
 * so it must be truthful: 'browser' means the engine performs no network I/O.
 * scripts/check-integrity.mjs fails the build if a 'browser' tool's engine
 * references fetch / XMLHttpRequest / WebSocket.
 */
export type ProcessingMode = 'browser' | 'server';

/** Shape of the interactive area, used by the page shell to pick a layout. */
export type ToolSurface =
  /** Drop files in, get files out. Needs a wide workspace + preview area. */
  | 'files'
  /** Text in, text out. Needs two tall panes side by side on desktop. */
  | 'text'
  /** A small form producing a compact result. Narrow column reads better. */
  | 'form';

export interface FaqItem {
  q: string;
  a: string;
}

export interface FeatureItem {
  title: string;
  body: string;
}

export interface ContentSection {
  heading: string;
  /** Paragraphs. Rendered as <p>, so keep each one to a single idea. */
  body: string[];
}

export interface HowTo {
  /** e.g. "How to compress an image" */
  title: string;
  steps: string[];
}

export interface AcceptSpec {
  /** For the file input `accept` attribute, e.g. ['image/jpeg', '.jpg']. */
  mime: string[];
  /** Human-readable, e.g. "JPG, PNG, WebP, GIF, BMP". */
  label: string;
  /** Per-file ceiling in bytes. Enforced client-side before decoding. */
  maxBytes: number;
  /** How many files can be queued at once. 1 = single-file tool. */
  maxFiles: number;
}

export interface Tool {
  /** URL segment. Chosen to match the primary search phrase. */
  slug: string;
  /** Short label for cards, nav and search results. */
  name: string;
  /** Page H1. Usually the same as `name`, occasionally longer. */
  h1: string;
  /** One sentence under the H1. Must explain the outcome, not the mechanism. */
  tagline: string;

  category: CategoryId;
  icon: IconName;
  surface: ToolSurface;
  processing: ProcessingMode;

  /** ≤ 60 chars including the suffix added by buildMetadata. */
  metaTitle: string;
  /** 120-158 chars. Written to earn the click, not to stuff keywords. */
  metaDescription: string;

  /** The single phrase this page is built to answer. */
  primaryKeyword: string;
  /** Supporting phrases that appear naturally in the copy. */
  secondaryKeywords: string[];
  /**
   * Alternate ways people describe this tool ("shrink image", "make photo
   * smaller"). Powers search only — never rendered, so it cannot become
   * keyword stuffing.
   */
  synonyms: string[];

  accepts?: AcceptSpec;

  howTo: HowTo;
  features: FeatureItem[];
  faq: FaqItem[];
  /** Genuinely explanatory prose. Rendered below the tool, never above it. */
  content: ContentSection[];

  /** Hand-picked cross-links. Auto-topped-up from the same category. */
  related: string[];

  /** Surfaces the tool on the homepage. Keep this list short and honest. */
  popular?: boolean;
  /** Shows a "New" pill for 30 days after `updated`. */
  isNew?: boolean;
  /** ISO date, used for sitemap lastModified. */
  updated: string;
}

export interface Category {
  id: CategoryId;
  name: string;
  slug: CategoryId;
  /** Card + hero one-liner. */
  tagline: string;
  /** Category page intro paragraph. */
  description: string;
  metaTitle: string;
  metaDescription: string;
  icon: IconName;
  /** Display order across nav, homepage grid and the footer. */
  order: number;
}
