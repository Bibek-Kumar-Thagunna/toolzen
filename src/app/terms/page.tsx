/**
 * Terms of Use.
 *
 * Short, readable, and limited to what is actually true of this site: it is
 * free, it runs in your browser, we make no promise that a result is correct,
 * and you keep the rights to your own files because we never receive them.
 *
 * Deliberately not a copy of a generic SaaS template. Most of the clauses in
 * one — account termination, subscription terms, data processing agreements,
 * licence grants over "user content" — describe obligations this site cannot
 * have, since it has no accounts, takes no payment and receives no content.
 * Claiming a licence over files we never receive would be both meaningless and
 * alarming.
 *
 * `/terms` is in `AD_FREE_ROUTES`.
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd } from '@/components/JsonLd';
import { PageHeader } from '@/components/PageHeader';
import { Prose } from '@/components/Prose';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Container } from '@/components/layout/Container';
import { brand } from '@/lib/brand';
import { buildMetadata, pageGraph } from '@/lib/seo';
import { routes } from '@/lib/site';

const title = 'Terms of Use';
const description = `The terms that apply to using ${brand.name}: free to use, no account, no warranty, and you keep every right to your own files.`;

const LAST_UPDATED = '10 September 2026';

export const metadata: Metadata = buildMetadata({
  title,
  description,
  path: routes.terms,
});

const trail = [
  { name: 'Home', href: routes.home },
  { name: 'Terms', href: routes.terms },
];

export default function TermsPage() {
  return (
    <Container size="prose" className="py-6 sm:py-10">
      <JsonLd graph={pageGraph({ path: routes.terms, title, description, trail })} />

      <Breadcrumbs trail={trail} className="mb-5" />

      <PageHeader
        title="Terms of Use"
        description={`Last updated ${LAST_UPDATED}. Using this site means accepting these terms.`}
      />

      <Prose className="mt-8">
        <h2>What you are agreeing to</h2>
        <p>
          {brand.name} is a free collection of browser-based utilities operated by{' '}
          {brand.legalName}. By using it you accept the terms below. If you do not accept them,
          please do not use the site.
        </p>

        <h2>The site is free, and provided as it is</h2>
        <p>
          Every tool here is free to use, for personal and commercial work alike, with no account
          and no watermark. In exchange, the site is provided <strong>as is</strong> and{' '}
          <strong>as available</strong>, without warranty of any kind. We do not promise that it
          will be available at any particular moment, that it will work in every browser, or that a
          result will be free of defects.
        </p>

        <h2>Check the results</h2>
        <p>
          These tools are written carefully and covered by an automated test suite, and they are
          still software. A converted image, a rebuilt PDF, a calculated figure or a generated value
          may be wrong in ways we have not anticipated — because of a browser bug, an unusual input,
          or a mistake of ours.
        </p>
        <p>
          <strong>
            Do not rely on any output here for anything consequential without checking it yourself.
          </strong>{' '}
          That applies with particular force to the calculators: a loan schedule or a percentage
          shown on this site is an illustration, not financial advice, and it is not a substitute
          for the figures your lender, accountant or adviser gives you.
        </p>

        <h2>Keep your originals</h2>
        <p>
          Work from a copy. Because processing happens on your device and nothing is stored, there
          is no version history to fall back on and no way for us to recover a file you have
          replaced. A tool that produces a new file is not a backup of the old one.
        </p>

        <h2>Your files stay yours</h2>
        <p>
          We claim no rights over anything you open in a tool here. We could not do so meaningfully
          in any case: your files are never transmitted to us, so we never possess them. See the{' '}
          <Link href={routes.privacy}>Privacy Policy</Link> for how that works.
        </p>

        <h2>Acceptable use</h2>
        <p>You agree not to use this site to:</p>
        <ul>
          <li>break the law, or process material you have no right to process;</li>
          <li>
            attack, overload or interfere with the site or the people using it, including by
            automated scraping that degrades it for others;
          </li>
          <li>
            misrepresent the site as your own, or republish it in a way that implies we endorse or
            operate something we do not.
          </li>
        </ul>
        <p>
          Using a tool on files you own, in bulk, for commercial work is expressly fine. The work
          happens on your own hardware, so there is nothing for us to ration.
        </p>

        <h2>Limitation of liability</h2>
        <p>
          To the fullest extent the law allows, {brand.legalName} is not liable for any loss or
          damage arising from your use of this site — including lost, corrupted or altered files,
          lost profits, or decisions taken on the basis of a result shown here. Nothing in these
          terms limits liability that cannot lawfully be limited.
        </p>

        <h2>Advertising</h2>
        <p>
          The site may display advertising to cover its costs. We do not endorse advertised products
          and have no control over their content; a dispute with an advertiser is between you and
          them. Ads never appear among a tool&rsquo;s controls, and the{' '}
          <Link href={routes.privacy}>Privacy Policy</Link> explains the cookies involved.
        </p>

        <h2>Third-party content</h2>
        <p>
          This site links to external documentation and standards. We do not control those sites and
          are not responsible for their content or their practices.
        </p>

        <h2>Changes</h2>
        <p>
          Tools may be added, changed or withdrawn without notice, and these terms may be updated.
          The date at the top of this page shows when the wording last changed; continuing to use
          the site after a change means accepting the revised terms.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms:{' '}
          <a href={`mailto:${brand.contact.email}`}>{brand.contact.email}</a>.
        </p>
      </Prose>

      <p className="mt-10 text-sm text-fg-muted">
        See also our <Link href={routes.privacy}>Privacy Policy</Link>.
      </p>
    </Container>
  );
}
