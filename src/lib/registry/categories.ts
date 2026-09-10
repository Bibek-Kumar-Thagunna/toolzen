import type { Category, CategoryId } from './types';

export const categories: Category[] = [
  {
    id: 'image',
    slug: 'image',
    name: 'Image tools',
    icon: 'image',
    order: 1,
    tagline: 'Compress, resize, crop and convert — without uploading anything.',
    description:
      'Every image tool here decodes and re-encodes your file using your own browser. Nothing is sent to a server, there is no queue, and you can run as many batches through them as you like.',
    metaTitle: 'Image Tools — Compress, Resize, Convert',
    metaDescription:
      'Free image tools that run in your browser: compress JPG and PNG, resize, crop, and convert between JPG, PNG and WebP. No uploads, no sign-up, no watermarks.',
  },
  {
    id: 'pdf',
    slug: 'pdf',
    name: 'PDF tools',
    icon: 'file-pdf',
    order: 2,
    tagline: 'Merge, split and build PDFs on your own device.',
    description:
      'PDFs often hold contracts, statements and scans — exactly the documents you should not be uploading to a stranger. These tools parse and rewrite the PDF locally, so the file never leaves your device.',
    metaTitle: 'PDF Tools — Merge, Split, Images to PDF',
    metaDescription:
      'Free PDF tools that run in your browser: merge PDFs into one file, split out page ranges, and turn images into a PDF. Your documents are never uploaded.',
  },
  {
    id: 'text',
    slug: 'text',
    name: 'Text tools',
    icon: 'text',
    order: 3,
    tagline: 'Count, clean and reshape text instantly.',
    description:
      'Small text jobs that would otherwise mean a spreadsheet formula or a throwaway script. Results update as you type, and nothing you paste is stored or transmitted.',
    metaTitle: 'Text Tools — Word Count, Case, Slugs',
    metaDescription:
      'Free online text tools: word and character counter, case converter, duplicate line remover and URL slug generator. Instant results, nothing uploaded.',
  },
  {
    id: 'developer',
    slug: 'developer',
    name: 'Developer tools',
    icon: 'code',
    order: 4,
    tagline: 'Format, decode and inspect — the daily plumbing, done well.',
    description:
      'Formatters and decoders you can safely paste a production payload into, because the parsing happens in your own tab. Tokens, keys and customer data never reach our logs.',
    metaTitle: 'Developer Tools — JSON, Base64, JWT, UUID',
    metaDescription:
      'Free developer tools that run locally in your browser: JSON formatter and validator, Base64 encoder and decoder, JWT decoder, and UUID generator.',
  },
  {
    id: 'calculators',
    slug: 'calculators',
    name: 'Calculators',
    icon: 'calculator',
    order: 5,
    tagline: 'Everyday maths with the working shown.',
    description:
      'Each calculator shows the formula it used and the intermediate numbers, so you can check the result instead of trusting it. Every input is shareable as a link.',
    metaTitle: 'Online Calculators — Percentage, Age, EMI',
    metaDescription:
      'Free online calculators with the formula shown: percentages, age, the difference between two dates, and loan EMI with a full amortisation schedule.',
  },
  {
    id: 'generators',
    slug: 'generators',
    name: 'Generators',
    icon: 'spark',
    order: 6,
    tagline: 'QR codes, strong passwords and colour palettes.',
    description:
      'Generators that produce a real, downloadable artefact rather than a preview. Passwords are produced with your browser’s cryptographic random source, never a seeded pseudo-random function.',
    metaTitle: 'Online Generators — QR Code, Password, Colours',
    metaDescription:
      'Free online generators: QR codes as PNG or SVG, cryptographically strong passwords, and colour palettes. Everything is generated locally in your browser.',
  },
];

const byId = new Map<CategoryId, Category>(categories.map((c) => [c.id, c]));

export function getCategory(id: string): Category | undefined {
  return byId.get(id as CategoryId);
}

export const categoryIds: CategoryId[] = categories
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((c) => c.id);

export function isCategoryId(value: string): value is CategoryId {
  return byId.has(value as CategoryId);
}
