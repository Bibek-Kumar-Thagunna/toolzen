/**
 * About.
 *
 * The page that answers "who is behind this and why should I trust it", which
 * for a site that asks you to hand it a passport scan is not a soft question.
 * It is also the page an ad-network reviewer opens second, after the home page.
 *
 * Written as an explanation of how the thing is built rather than a mission
 * statement, because the architecture *is* the argument: files are safe here
 * because there is no code that could upload them, not because we have promised
 * to be careful.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd } from '@/components/JsonLd';
import { PageHeader } from '@/components/PageHeader';
import { Prose } from '@/components/Prose';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Container } from '@/components/layout/Container';
import { brand } from '@/lib/brand';
import { categoriesWithTools, toolCount } from '@/lib/registry';
import { buildMetadata, pageGraph } from '@/lib/seo';
import { routes } from '@/lib/site';

const title = `About ${brand.name}`;
const description = `${brand.name} is ${toolCount} free browser-based tools for images, PDFs, text, code and everyday maths. This page explains how they work and why your files are never uploaded.`;

export const metadata: Metadata = buildMetadata({
  title,
  description,
  path: routes.about,
});

const trail = [
  { name: 'Home', href: routes.home },
  { name: 'About', href: routes.about },
];

export default function AboutPage() {
  const grouped = categoriesWithTools();

  return (
    <Container size="prose" className="py-6 sm:py-10">
      <JsonLd graph={pageGraph({ path: routes.about, title, description, trail })} />

      <Breadcrumbs trail={trail} className="mb-5" />

      <PageHeader
        title={`About ${brand.name}`}
        description={`${toolCount} small tools that do one job each, quickly, without asking you for anything.`}
      />

      <Prose className="mt-8">
        <h2>What this is</h2>
        <p>
          {brand.name} is a collection of {toolCount} utilities for the small jobs that come up
          around files and numbers: making a photo small enough to email, turning a stack of scans
          into one PDF, checking whether a JSON payload is valid, working out what a loan actually
          costs per month. Each one is a page that does a single thing.
        </p>
        <p>
          There is no account, no email capture, no free tier that runs out, and no watermark on
          anything. The tools are grouped into{' '}
          {grouped.map(({ category }, index) => (
            <span key={category.id}>
              {index > 0 ? (index === grouped.length - 1 ? ' and ' : ', ') : ''}
              <Link href={routes.category(category.slug)}>{category.name.toLowerCase()}</Link>
            </span>
          ))}
          .
        </p>

        <h2>Why the files stay on your device</h2>
        <p>
          The usual way to build a site like this is to accept an upload, do the work on a server,
          and send a file back. It is easier to write and it means the operator ends up holding a
          copy of every contract, medical scan and passport photograph their users happen to be
          resizing that day.
        </p>
        <p>
          These tools work the other way round. Your browser already contains an image decoder, an
          image encoder, a compression library and a fast JavaScript engine — the same machinery it
          uses to render every page you visit. The tools here drive that machinery directly, so the
          file is read, transformed and written without ever leaving the tab it was dropped into.
        </p>
        <p>
          This is a property of the code, not a policy we have adopted. There is no upload endpoint
          in this project, and an automated check refuses to build a tool marked
          &ldquo;browser-processed&rdquo; if its engine so much as references a network call. That
          is the version of a privacy promise we think is worth making: one that would take a
          deliberate, visible change to break.
        </p>
        <p>
          It has a real advantage beyond privacy. Nothing is queued behind anyone else&rsquo;s job,
          so a batch of twenty images starts immediately and runs as fast as your device can go.
        </p>

        <h2>What it costs, and how it is paid for</h2>
        <p>
          Nothing, and advertising. The site may carry up to two ad units on a tool page, both below
          the tool — never among the controls, never on the home page, and never on the{' '}
          <Link href={routes.privacy}>privacy</Link> or <Link href={routes.terms}>terms</Link>{' '}
          pages. Ads are held back while a tool is working, so nothing moves under your cursor while
          you are waiting for a result.
        </p>
        <p>
          Those are constraints written into the code rather than intentions: the interactive area
          of every tool page is a region in which an ad component renders nothing at all, and the
          per-page limit is enforced by a build-time check. If you use an ad blocker, everything
          here works normally and we will not ask you to turn it off.
        </p>

        <h2>What it will not do</h2>
        <p>
          No tool here will invent detail that was not in your file. There is no upscaler that
          &ldquo;enhances&rdquo; a blurry photo, no background remover that guesses, and no
          AI-generated anything. When a limit exists — the largest image a phone browser can draw,
          the formats a browser can write, the point at which JPEG quality starts to show — the tool
          says so plainly instead of failing quietly or pretending.
        </p>
        <p>
          Results should still be checked before they matter. See the{' '}
          <Link href={routes.terms}>Terms of Use</Link>.
        </p>

        <h2>Get in touch</h2>
        <p>
          Bug reports, wrong answers and requests for tools that should exist are all welcome:{' '}
          <a href={`mailto:${brand.contact.email}`}>{brand.contact.email}</a>. A description of what
          you did and what you expected is worth more than a screenshot of the error.
        </p>
      </Prose>

      <p className="mt-10 text-sm text-fg-muted">
        <Link href={routes.tools}>Browse all {toolCount} tools</Link>
      </p>
    </Container>
  );
}
