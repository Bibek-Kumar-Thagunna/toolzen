/**
 * ============================================================================
 * PRIVACY POLICY
 * ============================================================================
 * Two audiences, and the page has to satisfy both without lying to either.
 *
 * A visitor wants one question answered: does my file go anywhere? The answer
 * is at the top, in the first sentence, in plain language, because burying it
 * under "Introduction" and "Scope" is how privacy policies became something
 * nobody reads.
 *
 * An ad-network reviewer wants the disclosures their programme policies
 * require: that third parties may set cookies, that Google uses them to serve
 * ads, that a user can opt out and where, and how to contact the operator. Those
 * are here too, in their own headed sections.
 *
 * ── The one rule for editing this file ─────────────────────────────────────
 * Every sentence must be checkable against the code. If a future change makes
 * a sentence here false, the sentence changes in the same commit — a privacy
 * policy that has drifted from the software is worse than none, because people
 * have relied on it.
 *
 * Three of the claims are load-bearing enough that memory is not good enough,
 * so `scripts/check-integrity.mjs` enforces them and the build fails if they
 * stop being true (see `checkPrivacyClaims`):
 *
 *   "your files are never uploaded"   no tool engine or component may
 *                                     reference fetch, XMLHttpRequest,
 *                                     WebSocket, EventSource or sendBeacon.
 *   "your password is never sent"     the same check covers the locking tools.
 *   "your password is never stored"   the locking modules may not reference
 *                                     localStorage, sessionStorage, indexedDB
 *                                     or document.cookie — which is what stops
 *                                     a well-meant "remember this password"
 *                                     from quietly falsifying this page.
 *
 * The narrower storage rule is deliberate. Other tools do remember a
 * preference locally, and the "what stays on your device" section says so.
 *
 * `/privacy` is in `AD_FREE_ROUTES`. An advertisement beside a privacy
 * commitment reads as a contradiction, and it is.
 * ============================================================================
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { JsonLd } from '@/components/JsonLd';
import { PageHeader } from '@/components/PageHeader';
import { Prose } from '@/components/Prose';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { Container } from '@/components/layout/Container';
import { Alert } from '@/components/ui/Alert';
import { brand } from '@/lib/brand';
import { buildMetadata, pageGraph } from '@/lib/seo';
import { routes } from '@/lib/site';

const title = 'Privacy Policy';
const description = `How ${brand.name} handles your data: the files you open in a tool never leave your device, there are no accounts, and this page explains exactly what is and is not collected.`;

/**
 * The date the wording last changed. Hardcoded rather than computed from the
 * build, because "last updated: today" on every deploy is meaningless — the
 * date is supposed to tell a returning reader whether the terms they agreed to
 * have moved.
 */
const LAST_UPDATED = '12 September 2026';

export const metadata: Metadata = buildMetadata({
  title,
  description,
  path: routes.privacy,
});

const trail = [
  { name: 'Home', href: routes.home },
  { name: 'Privacy', href: routes.privacy },
];

export default function PrivacyPage() {
  return (
    <Container size="prose" className="py-6 sm:py-10">
      <JsonLd graph={pageGraph({ path: routes.privacy, title, description, trail })} />

      <Breadcrumbs trail={trail} className="mb-5" />

      <PageHeader
        title="Privacy Policy"
        description={`Last updated ${LAST_UPDATED}. This page describes what ${brand.name} does and does not do with your data.`}
      />

      <Alert variant="info" title="The short version" className="mt-6">
        The files you open in a tool on this site are processed by your own browser and are never
        uploaded to us. We have no accounts, ask for no personal details, and store nothing about
        you on our servers. If you lock a file with a password, that password never leaves your
        device — which also means we cannot open the file for you, ever. If advertising is switched
        on, Google may set cookies in your browser — that is the one third party involved, and the
        section below explains it.
      </Alert>

      <Prose className="mt-8">
        <h2>Who runs this site</h2>
        <p>
          {brand.name} is operated by {brand.legalName}. If you have a question about anything on
          this page, write to <a href={`mailto:${brand.contact.email}`}>{brand.contact.email}</a>.
        </p>

        <h2>Your files are not uploaded</h2>
        <p>
          Almost every tool here is marked <strong>&ldquo;processed in your browser&rdquo;</strong>,
          and that is a statement about how the software is built rather than a promise about how we
          behave. Those tools read your file into your device&rsquo;s own memory, do the work with
          the same code that draws images and lays out text in your other tabs, and hand the result
          back to you. There is no server endpoint that receives files, because none exists in the
          codebase.
        </p>
        <p>
          The practical consequences are worth stating plainly. Your file is never transmitted, so
          it is never stored, never queued behind anyone else&rsquo;s job, never logged, and never
          seen by us or by anyone we work with. Closing the tab is the deletion step. Nothing you
          process here can be recovered by us afterwards, including by a court order, because we
          never had it.
        </p>
        <p>
          A tool that ever needed to send data somewhere would say so on its own page, in the same
          place the browser-processing badge appears now. As of the date above, none does.
        </p>

        <h2>Passwords, and files you lock</h2>
        <p>
          Two tools on this site encrypt and decrypt files: <strong>Password Protect Files</strong>{' '}
          and <strong>Unlock a File</strong>. They deserve their own section, because a tool whose
          whole purpose is keeping something private has to be exact about what happens to the
          secret.
        </p>
        <ul>
          <li>
            <strong>Your password is never transmitted.</strong> It is used inside the page, by your
            browser&rsquo;s own cryptography, to derive a key. There is no request that carries it,
            because there is no server to carry it to.
          </li>
          <li>
            <strong>Your password is never stored.</strong> Not on a server, and not on your device
            either — nothing is written to local storage, and there is deliberately no
            &ldquo;remember this password&rdquo; option. It exists in the page while you are on it
            and is gone when you leave.
          </li>
          <li>
            <strong>We hold no key.</strong> There is no master password, no recovery code, no key
            escrow and no back door. The key is derived from your password and from nothing else.
          </li>
          <li>
            <strong>We cannot open your file, and neither can anyone who compels us.</strong> A
            locked file is not recoverable by us under any circumstances — not for you if you forget
            the password, and not for a law-enforcement request, a subpoena or a court order. There
            is nothing to hand over. This is a property of how the software is built, not a policy
            we could change our mind about.
          </li>
          <li>
            <strong>We do not know you used the tool at all</strong>, beyond an anonymous page view
            if analytics are enabled. Not what you locked, not how many files, not their names, not
            their contents.
          </li>
        </ul>
        <p>
          Two things about the files themselves are worth knowing, because they are properties of
          the formats rather than of this site. An encrypted <code>.zip</code> keeps its list of
          file names readable without the password — that is how the format works, so anyone holding
          the archive can see what is in it even though they cannot read it. A{' '}
          <code>.tzlock</code> hides its file names inside the encryption, but the optional password
          reminder is stored in the clear and can be read by anyone who has the file, which is why
          the form says to make it a nudge rather than the answer.
        </p>
        <p>
          The claim in this section is testable, and testing it is fair. Open the tool, disconnect
          from the internet, and lock or unlock a file. It works offline, because nothing was ever
          going to be sent. For a <code>.tzlock</code> there is also a{' '}
          <a href="/unlock.html">standalone unlocker</a>: one self-contained page you can save and
          use with no internet connection and no involvement from this site at all.
        </p>

        <h2>What we do not collect</h2>
        <ul>
          <li>
            <strong>No accounts.</strong> There is no sign-up, no login, and no password. We do not
            ask for your name or your email address, and there is no code in this site that would
            accept them.
          </li>
          <li>
            <strong>No file contents or file names.</strong> See the section above.
          </li>
          <li>
            <strong>No passwords.</strong> Neither the ones you type into the locking tools nor the
            ones the password generator produces for you. Nothing on this site has ever received a
            password and nothing stores one.
          </li>
          <li>
            <strong>No text you type or paste.</strong> What you put into a text tool, a calculator
            or a generator stays in the page.
          </li>
          <li>
            <strong>No cross-site tracking by us.</strong> We set no identifying cookie of our own
            and build no profile of you.
          </li>
        </ul>

        <h2>What stays on your device</h2>
        <p>
          Some conveniences are remembered in your browser&rsquo;s own local storage — your light or
          dark theme choice, for example. That data is written by your browser, stays on your
          device, is readable only by this site, and is never sent to us. Clearing your browser data
          removes it.
        </p>

        <h2>Analytics</h2>
        <p>
          If analytics are enabled, this site uses a privacy-preserving, cookieless analytics
          service that records aggregate page views and which tools are used. It sets no cookie,
          collects no personal data, stores no full IP address, and creates no identifier that could
          follow you to another site. We use it to learn which tools are worth building more of and
          which ones people open and then abandon — nothing about who you are.
        </p>

        <h2>Advertising and cookies</h2>
        <p>
          This site may display advertising to cover its running costs. Where it does, the ad
          network is <strong>Google AdSense</strong>, and it is the only third party that receives
          anything about your visit. The relevant disclosures:
        </p>
        <ul>
          <li>
            Third-party vendors, including Google, use cookies to serve ads based on your previous
            visits to this and other websites.
          </li>
          <li>
            Google&rsquo;s use of advertising cookies enables it and its partners to serve ads to
            you based on your visit to this site and other sites on the internet.
          </li>
          <li>
            You can opt out of personalised advertising by visiting{' '}
            <a
              href="https://www.google.com/settings/ads"
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              Google Ads Settings
            </a>
            . You can opt out of a third-party vendor&rsquo;s use of cookies for personalised
            advertising at{' '}
            <a
              href="https://www.aboutads.info/choices/"
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              aboutads.info
            </a>
            .
          </li>
          <li>
            Google&rsquo;s own description of how it handles data from sites that use its services
            is at{' '}
            <a
              href="https://policies.google.com/technologies/partner-sites"
              rel="noopener noreferrer nofollow"
              target="_blank"
            >
              policies.google.com/technologies/partner-sites
            </a>
            .
          </li>
        </ul>
        <p>
          Advertising never has access to the files you process here. An ad unit is an isolated
          frame; it cannot read the contents of the page around it, and the work your browser does
          on your file happens outside anything an advertiser can see. Ads never appear among a
          tool&rsquo;s controls, and never on this page or the home page.
        </p>
        <p>
          If you use an ad blocker, every tool on this site works exactly as it does without one. We
          do not detect blockers, do not ask you to disable one, and do not withhold anything if you
          do.
        </p>

        <h2>If you are in the EEA, UK or Switzerland</h2>
        <p>
          Where advertising is served to visitors in these regions, Google presents a consent
          message before setting advertising cookies, and your choice there governs whether
          personalised ads are shown. Because we hold no personal data ourselves, a request to
          access, correct or delete data held by us has nothing to act on — there is no record with
          your name on it. Requests concerning data held by Google should go to Google.
        </p>

        <h2>If you are in California</h2>
        <p>
          We do not sell or share personal information, because we do not collect it. Google&rsquo;s
          advertising practices are governed by its own policies, linked above, which include the
          opt-out mechanisms required in California.
        </p>

        <h2>Children</h2>
        <p>
          This site is a general-audience utility and is not directed at children under 13. We do
          not knowingly collect personal information from anyone, including children.
        </p>

        <h2>Links to other sites</h2>
        <p>
          Where a tool page links out — to a specification, a standards document, or a reference —
          that site has its own privacy practices, which we do not control.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          If the way this site handles data changes, the wording here changes with it and the date
          at the top moves. Substantive changes will be noted on the page rather than made quietly.
        </p>

        <h2>Contact</h2>
        <p>
          Questions, corrections and complaints:{' '}
          <a href={`mailto:${brand.contact.email}`}>{brand.contact.email}</a>.
        </p>
      </Prose>

      <p className="mt-10 text-sm text-fg-muted">
        See also our <Link href={routes.terms}>Terms of Use</Link> and{' '}
        <Link href={routes.about}>what this site is</Link>.
      </p>
    </Container>
  );
}
