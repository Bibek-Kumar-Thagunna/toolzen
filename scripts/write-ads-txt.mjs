/**
 * ============================================================================
 * ads.txt
 * ============================================================================
 * Google requires an `ads.txt` file at the root of a domain that shows AdSense.
 * Without one, the account shows an "Earnings at risk" banner and a share of
 * programmatic demand simply will not bid, because a buyer has no way to
 * confirm that this publisher is authorised to sell this inventory.
 *
 * ── Why it is generated rather than committed ─────────────────────────────
 * The file's only meaningful content is the publisher id, and that id does not
 * exist until the AdSense application is approved. Committing a placeholder
 * would be worse than committing nothing: an `ads.txt` that exists but does not
 * name the right publisher is read as "nobody is authorised to sell this", and
 * Google stops serving ads on the domain. That failure is silent and looks
 * exactly like poor fill.
 *
 * So the rule is all-or-nothing. With `NEXT_PUBLIC_ADSENSE_CLIENT` set, the
 * file is written from it. Without it, any previously written copy is deleted,
 * so a build that has no publisher id ships no `ads.txt` at all.
 *
 * ── The exchange id is not a secret and not a guess ───────────────────────
 * `f08c47fec0942fa0` is Google's own certification authority id, identical for
 * every AdSense publisher on earth. It appears in Google's published example
 * and in the ads.txt of every site running AdSense.
 *
 * Run automatically before every build; safe to run by hand.
 * ============================================================================
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GOOGLE_CERTIFICATION_ID = 'f08c47fec0942fa0';
const target = join(process.cwd(), 'public', 'ads.txt');

const raw = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim() ?? '';

if (raw === '') {
  if (existsSync(target)) {
    rmSync(target);
    console.log('ads.txt: no publisher id set — removed the stale file.');
  } else {
    console.log('ads.txt: no publisher id set — nothing written (correct before approval).');
  }
  process.exit(0);
}

// AdSense shows the id as `ca-pub-…`; ads.txt wants the bare `pub-…` form.
// Getting this wrong is the single most common ads.txt mistake, and its symptom
// is "unauthorised" rather than a syntax error.
const publisher = raw.replace(/^ca-/, '');

if (!/^pub-\d{16}$/.test(publisher)) {
  console.error(
    `ads.txt: "${raw}" is not a publisher id. Expected ca-pub- followed by 16 digits.`,
  );
  process.exit(1);
}

const body = [
  '# Authorised digital sellers for this domain.',
  '# https://iabtechlab.com/ads-txt/',
  `google.com, ${publisher}, DIRECT, ${GOOGLE_CERTIFICATION_ID}`,
  '',
].join('\n');

writeFileSync(target, body, 'utf8');
console.log(`ads.txt: written for ${publisher}.`);
