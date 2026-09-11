import type { Tool } from '../types';

/**
 * Calculators.
 *
 * Each entry describes what the engines in `src/lib/tools/calc` really compute,
 * including the conventions they choose and the cases they refuse. The EMI copy
 * is deliberately written as an estimate rather than as advice.
 */
export const calculatorTools: Tool[] = [
  {
    slug: 'percentage-calculator',
    name: 'Percentage Calculator',
    h1: 'Percentage Calculator',
    tagline: 'Seven of the percentage questions that come up in real work, each answered with its working.',
    category: 'calculators',
    icon: 'percent',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'Percentage Calculator with Steps',
    metaDescription:
      'Work out a percentage of a number, a percentage change, a reverse percentage and more, with the formula and every step shown.',
    primaryKeyword: 'percentage calculator',
    secondaryKeywords: [
      'percentage change',
      'percentage of a number',
      'percentage difference',
      'reverse percentage',
      'percentage increase',
      'what percent of',
    ],
    synonyms: [
      'percent calculator',
      'percentage formula',
      'work out a percentage',
      'percent change calculator',
      'discount calculator',
      'percentage tool',
    ],
    howTo: {
      title: 'How to calculate a percentage',
      steps: [
        'Pick the question you are answering, such as "what is 15% of 240" or "36 is what percent of 240".',
        'Type your two numbers into the boxes.',
        'Read the formula line to see which calculation was used, and the steps table for the numbers that went into it.',
        'Switch modes to check the same figures another way, for instance by turning a percentage increase back into the original amount.',
      ],
    },
    features: [
      {
        title: 'Seven modes, named as questions',
        body: 'What is X% of Y. X is what percent of Y. The percentage change from X to Y. Y after adding or subtracting X%. The original amount before X% was applied. The percentage difference between two values. And each item in a list as a share of the total.',
      },
      {
        title: 'The working is shown, not just the answer',
        body: 'Every result comes with the formula it used and a table of the intermediate values, so you can copy the method into a spreadsheet or check it by hand. That also makes it obvious which of two similar-sounding questions you actually asked.',
      },
      {
        title: 'Change and difference are kept apart',
        body: 'Percentage change divides by the starting value and has a direction, so 40 to 50 is a 25% increase. Percentage difference divides by the average of the two and has none, so the same pair are 22.22% apart. Mixing them up is the most common percentage error in a report.',
      },
      {
        title: 'Reverse percentages that come out right',
        body: 'A price of 120 after a 20% increase started at 100, not 96, because the increase applied to the smaller number. The reverse mode divides by the multiplier rather than subtracting the percentage, which is how you recover a pre-tax price or a pre-discount total.',
      },
      {
        title: 'Shares that add up to exactly 100%',
        body: 'Three equal parts rounded to two decimals give 33.33% three times, which sums to 99.99% and looks like a bug in your report. The share mode uses largest-remainder rounding, so the column always totals 100% and the same input always distributes the leftovers the same way.',
      },
      {
        title: 'Impossible questions get an explanation',
        body: 'A percentage change from zero is refused, because an increase from nothing has no finite percentage, and a percentage difference needs an average that is not zero. Negative parts in a share table are refused as well, since they make the percentages meaningless rather than merely negative.',
      },
    ],
    faq: [
      {
        q: 'What is the difference between percentage change and percentage difference?',
        a: 'Percentage change compares a new value against a starting value, so it has a direction and the baseline is one of the two numbers. Percentage difference compares two values against their average, so it is symmetric and always positive. Going from 40 to 50 is a 25% change but a 22.22% difference.',
      },
      {
        q: 'A price is 120 after a 20% rise. Why is the original 100 and not 96?',
        a: 'Because the 20% was calculated on the original price, not on the final one. Taking 20% off 120 gives 96, which is 20% below the wrong number. Dividing 120 by 1.2 gives 100, and adding 20% to 100 returns 120, which is the check that matters.',
      },
      {
        q: 'Why do my percentages add up to 100% here but not in my spreadsheet?',
        a: 'A spreadsheet rounds each share on its own, so the rounding errors accumulate and the column lands on 99.99% or 100.01%. This tool assigns the leftover hundredths to the shares with the largest remainders, a method also known as Hare-Niemeyer, so the total is exactly 100%.',
      },
      {
        q: 'Why will it not calculate a percentage change from zero?',
        a: 'Because there is no answer to give. Any increase from nothing is infinitely large in percentage terms, so the honest response is to say so rather than to print a very big number. Zero to zero is reported as no change at all.',
      },
      {
        q: 'Does it round the results?',
        a: 'The arithmetic is done at full precision and only the displayed figure is rounded, so a result is never calculated from an already-rounded intermediate value. The steps table shows the unrounded numbers that were used, which is where to look if a total seems a hundredth out.',
      },
      {
        q: 'Is anything I type sent to a server?',
        a: 'No. The arithmetic runs in this page, so your figures never leave your device and nothing is stored between visits. It also keeps working if you lose your connection.',
      },
    ],
    content: [
      {
        heading: 'Percentage change, percentage difference, and which one you want',
        body: [
          'These two are constantly swapped, and the swap changes the number. Percentage change is the one almost everybody means: it takes a starting value, compares the new value against it, and divides by the starting value. A revenue figure that moves from 40 to 50 has changed by 25%, because the 10 of growth is a quarter of the 40 you began with.',
          'Percentage difference makes no assumption about which value came first. It divides the gap by the average of the two, which makes the answer symmetric: 40 against 50 gives 22.22%, and so does 50 against 40. That is the right measure when neither number is a baseline, such as when two instruments measure the same thing and you want to know how far apart they are.',
          'The direction matters too. A rise from 40 to 50 is a 25% increase, but the fall from 50 back to 40 is a 20% decrease, because the baseline has changed. This is why a stock that drops 50% has to rise 100% to recover, and why the percentage change here always names the value it divided by.',
        ],
      },
      {
        heading: 'Working backwards from a price that already includes a percentage',
        body: [
          'Reverse percentage is the mode people most often need and least often trust. The question is always the same shape: this number already has a percentage baked into it, so what was it before. A total of 120 including 20% tax, a sale price of 80 after 20% off, a salary of 52,000 after a 4% rise.',
          'The wrong method is to apply the percentage to the number you have. Taking 20% off 120 gives 96, which is wrong because the tax was never 20% of 120; it was 20% of the pre-tax price. The right method is to divide by the multiplier: 120 divided by 1.2 is 100 for the tax case, and 80 divided by 0.8 is 100 for the discount.',
          'The check is quick and worth doing. Take the answer, apply the original percentage to it, and see whether you get back the number you started with. This tool does that arithmetic in the direction you ask for and prints the multiplier it used, so the two directions can be compared side by side.',
        ],
      },
      {
        heading: 'Why percentages sometimes refuse to behave',
        body: [
          'Percentages of percentages do not add. A 10% rise followed by a 10% fall does not return you to where you started: 100 becomes 110, then 99. Two successive changes multiply their multipliers, which is 1.1 times 0.9, or 0.99. Adding the percentages instead is the arithmetic behind a surprising number of wrong invoices.',
          'Floating point is the other source of oddities. Adding 15% to 200 by multiplying by 1.15 gives 229.99999999999997 in almost every programming language, because neither value is exactly representable in binary. The add-a-percentage mode works out the increase and adds it to the original instead, which keeps the answer on the number a person would write down.',
        ],
      },
    ],
    related: ['emi-calculator', 'date-difference-calculator', 'age-calculator'],
    popular: true,
    updated: '2026-09-03',
  },
  {
    slug: 'age-calculator',
    name: 'Age Calculator',
    h1: 'Age Calculator',
    tagline: 'Know an age to the day, and exactly how long it is until the next birthday.',
    category: 'calculators',
    icon: 'calendar',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'Age Calculator: Years, Months and Days',
    metaDescription:
      'Find an exact age in years, months and days from a date of birth, plus total days, the next birthday and the weekday it falls on.',
    primaryKeyword: 'age calculator',
    secondaryKeywords: ['date of birth', 'how old am i', 'exact age', 'next birthday', 'age in days'],
    synonyms: [
      'birthday calculator',
      'how old am I',
      'date of birth calculator',
      'age in months',
      'work out my age',
      'birthday countdown',
    ],
    howTo: {
      title: 'How to work out an exact age',
      steps: [
        'Enter the date of birth. 1996-02-29, 29/02/1996 and 2/29/1996 are all read correctly.',
        'Leave the second date on today, or set it to any other day to get the age as it was or will be then.',
        'Read the years, months and days line first, then the totals and the next birthday below it.',
        'Open the working if a figure surprises you: it names the month that a borrowed day count was taken from.',
      ],
    },
    features: [
      {
        title: 'Calendar arithmetic, not an average year',
        body: 'The years, months and days come from borrowing across real month lengths, never from dividing total days by 365.25. That shortcut is out by a day or more for most people, and by three days for a leap-day birth.',
      },
      {
        title: 'The same age in the units people actually ask for',
        body: 'Alongside the breakdown you get whole calendar months lived, whole weeks with the odd days shown separately, and the same age in days, hours and minutes. Whole months are years times twelve plus months, not days divided by thirty.',
      },
      {
        title: 'The next birthday, with its weekday',
        body: 'You get the date, how many days away it is, the day of the week it lands on, and the age being reached. If it is today, the tool says so instead of counting forward to next year.',
      },
      {
        title: 'Leap-day births are handled explicitly',
        body: 'A 29 February birthday is observed on 28 February in a common year, so that is the date shown for the next birthday. The strict breakdown still reads 29 years, 11 months and 30 days on 28 February 2026 for a 1996 birth, because the 29th has not come round.',
      },
      {
        title: 'Borrowed days are traceable',
        body: 'When the leftover days are counted from a monthly anniversary that sits in the previous month, the working names that month and its length, such as "January 2026 (31 days)". That length is what decides whether the answer ends in 30 days or 31.',
      },
      {
        title: 'Conventions are labelled as conventions',
        body: 'The star sign uses the usual fixed date ranges rather than the sun\'s real position, and the Chinese zodiac animal is marked uncertain for births before 21 February, because the lunar new year moves from year to year.',
      },
    ],
    faq: [
      {
        q: 'How are the years, months and days worked out?',
        a: 'By calendar borrowing. Whole months are counted first, and the leftover days are measured from the last monthly anniversary using the real length of the month involved. The same gap can therefore end in 28 days or 30 days depending on which month it crossed.',
      },
      {
        q: 'What happens with a 29 February birthday?',
        a: 'In a common year the observed birthday is 28 February, so that is the date and weekday shown. The strict age does not tick over until 1 March, so on that one day the age being turned reads one higher than the completed years, and both figures are shown rather than one being quietly adjusted.',
      },
      {
        q: 'Does my time zone or daylight saving change the answer?',
        a: 'No. The engine works on civil dates and counts whole days, so no clock time can move a result by one. The page passes your local calendar day as the day to measure to, which means the age turns over at your midnight rather than at UTC midnight.',
      },
      {
        q: 'Why does it refuse a date of birth in the future?',
        a: 'Because a negative age is not an answer worth printing, and the usual cause is a mistyped year. The message repeats both dates so you can see which of the two is wrong.',
      },
      {
        q: 'Can I get an age at some other date?',
        a: 'Set the second date to the day you care about, such as when a contract starts or a policy renews. The breakdown, the totals and the next birthday are all measured against that day instead of today.',
      },
      {
        q: 'Is the date of birth I type stored or sent anywhere?',
        a: 'No. The calculation runs in this page, so the date never leaves your device and nothing is kept once you close the tab. A date of birth is sensitive enough to be worth saying plainly.',
      },
    ],
    content: [
      {
        heading: 'Why a quick division gives the wrong age',
        body: [
          'The tempting way to answer "how old am I" is to subtract two dates, divide the days by 365.25 and take the whole part. It is close, and it is wrong often enough to matter. The average year length is a compromise across the leap cycle, so for any particular person it is either slightly too long or slightly too short, and the error lands exactly where people check: on and around a birthday.',
          'Calendar borrowing gives the answer people mean. Count whole years from the birth date, then whole months, then count the leftover days from the last monthly anniversary. Each step uses the real length of the month it crosses, which is why the days part can be anything from 0 to 30 and why the tool shows which month it drew on.',
          'The distinction shows up in totals as well. Whole months lived here is years times twelve plus months, so someone who is 30 years and 6 months old has lived 366 whole months. Dividing total days by 30 would say 371, which is not a month count of anything.',
        ],
      },
      {
        heading: 'Leap days, month ends and the other lumpy bits of a calendar',
        body: [
          'A birthday on 31 January has no anniversary in February, and one on 29 February has none in three years out of four. Both cases are resolved by clamping to the last day of the target month, which is the convention almost every legal and payroll system uses: the observed date moves to 28 February or 30 April rather than spilling into the next month.',
          'The strict age is deliberately not clamped. Someone born on 29 February 1996 is 29 years, 11 months and 30 days old on 28 February 2026, because the day they were born on does not exist that year. They will still tell you they turned thirty that morning, and the next birthday line agrees with them. Two answers to the same question are the honest result here, so both are shown.',
          'Everything else is counted in whole days from a day number, which removes a whole class of bugs. There is no hour to be lost to a daylight-saving change, no month to be shifted by a time zone, and no drift between the countdown, the date and the weekday: the birthday date, the days remaining and the day of the week are all derived from the same number.',
        ],
      },
    ],
    related: ['date-difference-calculator', 'qr-code-generator', 'percentage-calculator'],
    updated: '2026-09-03',
  },
  {
    slug: 'date-difference-calculator',
    name: 'Date Difference',
    h1: 'Date Difference Calculator',
    tagline: 'Answer how long between two dates, whether you mean calendar days or working days.',
    category: 'calculators',
    icon: 'clock',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'Date Difference Calculator',
    metaDescription:
      'Count the days between two dates, in years, months and days or as a plain total, and count working days with your own holiday list.',
    primaryKeyword: 'date difference calculator',
    secondaryKeywords: [
      'days between two dates',
      'working days',
      'business days',
      'calendar days',
      'networkdays',
    ],
    synonyms: [
      'days between dates',
      'date duration calculator',
      'how many days until',
      'working days calculator',
      'business day calculator',
      'time between two dates',
    ],
    howTo: {
      title: 'How to count the days between two dates',
      steps: [
        'Enter the two dates. If they are the wrong way round they are swapped for you, and the swap is reported.',
        'Read the total days first, then the years, months and days breakdown and the weeks-and-days line.',
        'Switch to working days for Monday to Friday only, and paste any public holidays as YYYY-MM-DD.',
        'Include the end date when both ends are whole days you are counting, such as a leave request.',
      ],
    },
    features: [
      {
        title: 'Two questions, two honest defaults',
        body: 'A duration and a head count are not the same thing, so the defaults differ. A plain difference leaves the end date out, because 1 January to 2 January is one day. Working days include it, so Monday to Friday is five, which is what Excel\'s NETWORKDAYS also answers.',
      },
      {
        title: 'Every unit from a single pass',
        body: 'One calculation gives total days, whole weeks plus the remainder, the years, months and days breakdown, the number of Monday-to-Friday days, the number of weekend days, and the totals in hours and minutes. They all come from the same day span, so they cannot contradict each other.',
      },
      {
        title: 'Your holidays, not a guessed calendar',
        body: 'There is no built-in public holiday list, because holidays depend on the country, the region and sometimes the employer. You supply the dates, and the result names the ones that were applied and the ones that were ignored, with the reason for each.',
      },
      {
        title: 'Dates read the way you typed them',
        body: 'ISO, day-first and month-first inputs are all accepted. When 03/04/2026 could be either, the tool resolves it with the day-first setting and records the assumption as a note instead of choosing in silence.',
      },
      {
        title: 'The weekend is Saturday and Sunday',
        body: 'That is fixed and not configurable, so a Friday and Saturday working week is not modelled. Listing the Fridays as holidays gets part of the way there, but Sundays will still be counted as weekend rather than as business days.',
      },
    ],
    faq: [
      {
        q: 'Is the end date counted or not?',
        a: 'For a plain difference it is not, because a duration from 1 January to 2 January is one day. For working days it is included by default, so Monday to Friday comes out as five. Either behaviour can be switched.',
      },
      {
        q: 'Which public holidays does it know about?',
        a: 'None, deliberately. A built-in calendar would be wrong for somebody in every release, so you paste the dates that apply where you are and the tool shows which of them actually changed the total.',
      },
      {
        q: 'Why was one of my holidays ignored?',
        a: 'Three reasons are possible and each one is reported: the date fell outside the range, it was already a Saturday or Sunday so subtracting it would double-count, or it appeared twice in the list.',
      },
      {
        q: 'What if I enter the dates in the wrong order?',
        a: 'They are swapped and the result says so. A negative duration is almost never what anybody wants, and rejecting the input would just mean retyping it.',
      },
      {
        q: 'Does it treat a month as 30 days?',
        a: 'No. The breakdown borrows across real month lengths, so the months part counts whole calendar months and the days part is the remainder. Use the total days figure for anything that has to reconcile, since it is an exact count.',
      },
      {
        q: 'Does anything I type leave my device?',
        a: 'No. Both counts, including the holiday list, run in this page, and nothing is stored between visits.',
      },
    ],
    content: [
      {
        heading: 'Calendar days, working days, and the off-by-one behind every argument',
        body: [
          'Almost every disagreement about a date range is really a disagreement about the ends. "How long is it from Monday to Friday" has two defensible answers: four, if you mean the length of the gap, and five, if you mean the number of days you will be in the office. Neither is wrong, and a tool that only implements one of them will look broken to half its users.',
          'So both are here, with the defaults that match the question being asked. The plain difference treats the range as a duration and excludes the end date. The working-day count treats the range as a list of days and includes it, which is the same convention as spreadsheet NETWORKDAYS functions, so a figure from here will agree with a figure from a colleague\'s spreadsheet.',
          'The working-day count also stays exact over long ranges without walking the calendar. Every whole week in the range contributes exactly five, and only the ragged tail of at most six days is inspected, so a range spanning fifty years is as fast and as correct as one spanning a fortnight.',
        ],
      },
      {
        heading: 'The parts a date tool should not guess',
        body: [
          'Holidays are the obvious one. There is no single national calendar for most countries, regional holidays differ inside them, substitute days move when a holiday lands on a weekend, and employers add days of their own. A built-in list would be quietly wrong for a large fraction of visitors, and quietly wrong is the worst failure mode a calculator has. Supplying your own list takes a few seconds and the result tells you exactly what it did with each entry.',
          'Ambiguous input is the other one. 03/04/2026 is 3 April in most of the world and 4 March in the United States, and there is nothing in the string itself to settle it. The parser applies the day-first setting and then says which reading it used, so a wrong assumption is visible on the page rather than buried in the total. ISO dates in YYYY-MM-DD form have no ambiguity at all and are the safest thing to paste.',
          'Everything is counted in whole civil days rather than timestamps. That removes daylight saving, time zones and leap seconds from the problem entirely: a range measured here is the same range for a reader in Auckland and a reader in Vancouver, which is not true of an answer computed from two instants in time.',
        ],
      },
    ],
    related: ['age-calculator', 'emi-calculator', 'qr-code-generator', 'percentage-calculator'],
    updated: '2026-09-03',
  },
  {
    slug: 'emi-calculator',
    name: 'EMI Calculator',
    h1: 'EMI Calculator',
    tagline: 'See the monthly instalment a loan of this size implies, and where the interest actually goes.',
    category: 'calculators',
    icon: 'calculator',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'EMI Calculator and Amortisation Table',
    metaDescription:
      'Estimate a reducing-balance EMI, the total interest and a month-by-month amortisation schedule that reconciles to the last cent.',
    primaryKeyword: 'emi calculator',
    secondaryKeywords: [
      'monthly instalment',
      'amortisation schedule',
      'reducing balance',
      'total interest',
      'loan repayment',
    ],
    synonyms: [
      'loan calculator',
      'equated monthly instalment',
      'home loan emi',
      'car loan calculator',
      'mortgage payment calculator',
      'loan amortisation calculator',
    ],
    howTo: {
      title: 'How to estimate a monthly instalment',
      steps: [
        'Enter the amount borrowed, the annual interest rate and the term in whole months.',
        'Read the instalment, the total interest, and how much of everything paid is interest rather than capital.',
        'Open the schedule to see each month split into interest and capital, or the yearly summary for a shorter view.',
        'Add an extra monthly amount to see how much interest it removes and how many months earlier the loan ends.',
      ],
    },
    features: [
      {
        title: 'The standard annuity formula, stated',
        body: 'The instalment is P x r x (1 + r)^n divided by ((1 + r)^n - 1), with the monthly rate taken as the annual rate divided by twelve. Interest each month is charged on the amount still outstanding, which is the reducing balance method most instalment loans use. A 0% loan is repaid in equal slices of capital instead.',
      },
      {
        title: 'A schedule that reconciles',
        body: 'The loan is walked month by month in whole cents rather than in floating-point currency, and the residual left over by rounding the instalment is added to the final payment. The last closing balance is exactly zero, and the totals are summed from the rows on screen rather than from a separate formula.',
      },
      {
        title: 'Overpayments measured against the same loan',
        body: 'An extra amount is added on top of each scheduled instalment rather than folded into it, so all of it goes to capital. The comparison reports the interest saved and how many months early the loan finishes, both taken from a second run of the same schedule.',
      },
      {
        title: 'Yearly summary as well as the full table',
        body: 'A 360-row table is not readable, so the schedule can be collapsed to one row a year showing interest, capital and the closing balance. Years are numbered from the first payment, because a term given in months carries no start date.',
      },
      {
        title: 'The reverse question too',
        body: 'Given a payment you have in mind, a rate and a term, the same formula inverted gives the amount that instalment supports. Both directions print the monthly rate to eight decimal places, so multiplying the shown figures back out reproduces the answer to the cent.',
      },
      {
        title: 'Limits are stated, not silently exceeded',
        body: 'The term is capped at 600 months, which is 50 years, in whole months only, and amounts at 100 billion. A loan that works out at less than a cent a month is refused with an explanation rather than reported as zero.',
      },
    ],
    faq: [
      {
        q: 'Will a lender quote this exact instalment?',
        a: 'Most likely not, and the gap is not an error here. This is an estimate of the standard formula alone. A real quote can also carry processing fees, insurance, a different day-count convention, a rate that is reset periodically and the lender\'s own rounding, none of which are modelled.',
      },
      {
        q: 'Is this financial advice?',
        a: 'No. It is arithmetic that reports what the standard formula produces for the numbers entered. Nothing here is a recommendation, an offer or a quote, and borrowing decisions belong to you and, if you want one, a qualified adviser.',
      },
      {
        q: 'What does EMI mean?',
        a: 'Equated monthly instalment: one level payment made every month for the whole term, inside which the interest share falls and the capital share rises as the balance comes down. The payment stays the same, which is why only the last one may differ by a few cents.',
      },
      {
        q: 'Why is the final payment slightly different?',
        a: 'Because the instalment is rounded to the cent, and a few hundred rounded payments almost never clear the balance exactly. Rather than leave a stray amount outstanding or hand over more than is owed, the engine puts the residual into the last payment.',
      },
      {
        q: 'How is the monthly rate derived from the annual rate?',
        a: 'The annual percentage is divided by twelve, which is the convention this formula assumes, so twelve equal months are used and calendar day counts are ignored. A lender working from actual days, or quoting an effective annual rate, will land on a slightly different figure.',
      },
      {
        q: 'Do the loan figures I type leave my device?',
        a: 'No. The instalment, the schedule and the comparison all run in this page, so amounts and rates stay on your machine and nothing is stored between visits.',
      },
    ],
    content: [
      {
        heading: 'What the formula assumes, and what a lender adds',
        body: [
          'The annuity formula behind an EMI has four inputs and no room for anything else: the amount borrowed, a periodic interest rate, the number of periods, and the assumption that every payment is identical. It answers one question exactly, which is what a level payment must be for the balance to reach zero after the last period. Everything else about a loan sits outside it.',
          'That is why a figure from any EMI calculator and a figure from a lender rarely match to the cent. The rate here is the annual figure divided by twelve, so months are treated as equal and calendar days do not enter into it. Real agreements may accrue on actual days, capitalise fees into the principal, add insurance premiums to the instalment, reset a floating rate at intervals, or round in their own direction at each step.',
          'None of that makes the estimate useless; it makes it a baseline. It is the right number for comparing two terms, for seeing what a rate change does to a payment, or for sanity-checking a quote that looks far away from it. It is the wrong number to sign anything on the strength of.',
        ],
      },
      {
        heading: 'Where the interest goes, and what an overpayment changes',
        body: [
          'A loan repayment is not one thing but two. Each instalment first covers the interest that has accrued on the outstanding balance, and whatever is left reduces the balance itself. Early on, the balance is at its largest, so most of the payment is interest. As the balance falls the interest falls with it, so a larger share of the same payment goes to capital every month. The schedule makes that shift visible, which is usually more informative than the total.',
          'This is also why an extra payment is worth so much more at the start of a term than at the end. Any amount that reduces the balance early removes the interest that balance would have generated for every remaining month. The engine adds the extra amount on top of the instalment rather than inside it, so all of it goes to capital, and it reports both the interest removed and the number of months saved.',
          'The arithmetic is done in whole cents from beginning to end for a plain reason: currency does not survive floating-point addition intact. Adding a few hundred values ending in .07 and .53 in binary floating point leaves a total that is a cent or two away from the sum of the printed rows, and a schedule whose column does not add up to its own total invites the reader to distrust all of it. Integer cents, with the rounding residual pushed into the final payment, makes the table and the summary agree.',
        ],
      },
    ],
    related: ['percentage-calculator', 'date-difference-calculator', 'age-calculator'],
    updated: '2026-09-03',
  },

  {
    slug: 'bmi-calculator',
    name: 'BMI Calculator',
    h1: 'BMI calculator',
    tagline: 'Work out your body mass index, and see plainly what the number does and does not mean.',
    category: 'calculators',
    icon: 'scale',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'BMI Calculator — Metric and Imperial',
    metaDescription:
      'Calculate BMI in kg and cm or in pounds, stones, feet and inches. Shows the WHO bands, your healthy weight range, and what BMI cannot tell you.',
    primaryKeyword: 'bmi calculator',
    secondaryKeywords: [
      'body mass index',
      'bmi chart',
      'healthy weight for my height',
      'bmi in kg and cm',
      'bmi feet and inches',
    ],
    synonyms: [
      'calculate bmi',
      'what is my bmi',
      'body mass index calculator',
      'bmi checker',
      'ideal weight calculator',
      'am i overweight',
      'bmi metric',
    ],
    howTo: {
      title: 'How to calculate your BMI',
      steps: [
        'Enter your weight and choose kilograms, pounds or stones.',
        'Enter your height. Choosing feet gives you separate feet and inches boxes.',
        'Read the figure, and the World Health Organization band it falls in.',
        'Check the healthy weight range for your height underneath.',
      ],
    },
    features: [
      {
        title: 'What the number means, next to the number',
        body: 'BMI is a population screening ratio, not a diagnosis. It compares weight with height and nothing else, so it cannot tell muscle from fat and takes no account of age, sex, ethnicity or build. That sentence sits under the result, not behind a tooltip.',
      },
      {
        title: 'No red and green',
        body: 'The bands are shown as a table with your row marked. Colouring a figure red turns a screening ratio into a verdict on a person, which is exactly the reading this tool is trying to avoid.',
      },
      {
        title: 'Feet and inches are two boxes',
        body: 'Five foot nine is 5.75 feet, not 5.9 — a division most calculators leave to the reader, and the commonest way to get a wrong BMI. Type the feet and the inches separately and the conversion is done for you.',
      },
      {
        title: 'The healthy weight range for your height',
        body: 'The BMI formula run backwards: what BMI 18.5 to 24.9 actually weighs at your height, in both kilograms and pounds, plus the signed distance from where you are to the nearest edge.',
      },
      {
        title: 'The WHO’s own band names',
        body: 'Severe, moderate and mild thinness, normal range, pre-obese and the three obese classes — the labels the World Health Organization uses, rather than the softer ones most calculators substitute.',
      },
      {
        title: 'The working is shown',
        body: 'Weight in kilograms divided by height in metres squared, with your figures substituted in. Nothing is hidden behind the answer.',
      },
    ],
    faq: [
      {
        q: 'Is BMI accurate for me?',
        a: 'It is accurate as arithmetic and limited as a measure. BMI was designed to describe populations, not individuals: it knows only your weight and your height, so a muscular athlete and a sedentary person of the same build get the same number. Treat it as one rough indicator among several, and speak to a health professional about anything that matters.',
      },
      {
        q: 'What is a healthy BMI?',
        a: 'The World Health Organization puts the normal range at 18.5 to just under 25 for adults. Public-health guidance usually quotes 18.5 to 24.9, which is a hair narrower — both figures appear here, and they answer slightly different questions.',
      },
      {
        q: 'Does this work for children?',
        a: 'No. A child or teenager’s BMI has to be read against age-and-sex percentile charts, because the same number means different things at eight and at thirty-eight. This calculator uses the adult bands only.',
      },
      {
        q: 'Why does my BMI differ from another site?',
        a: 'Almost always a rounding or a unit-conversion difference — particularly height in feet, where 5 ft 9 in is 5.75 and not 5.9. The figure here is rounded to two decimals and the band is chosen from that rounded figure, so the number and the label always agree.',
      },
      {
        q: 'What is BMI Prime?',
        a: 'Your BMI divided by 25, so 1.00 sits exactly on the top of the normal band. It makes "how far above or below the range am I" a single ratio rather than a subtraction, which is why clinicians sometimes prefer it.',
      },
      {
        q: 'Is my data sent anywhere?',
        a: 'No. The arithmetic runs in this page. Your height and weight are never transmitted and never stored.',
      },
    ],
    content: [
      {
        heading: 'What BMI actually measures',
        body: [
          'Body mass index is weight in kilograms divided by height in metres squared. That is the whole formula, and its simplicity is both why it is used everywhere and why it is so often misread.',
          'It was devised in the nineteenth century to describe the distribution of body types across a population, and it is genuinely useful for that: at the scale of a country, BMI tracks health outcomes well enough to guide policy. What it was never built to do is assess one person, because it has no way to know what the weight is made of.',
          'The practical consequence is that a rugby player and someone carrying the same weight as fat share a BMI, and so do a tall person and a short one whose health risks differ. The number is a starting point for a conversation, not the end of one.',
        ],
      },
      {
        heading: 'Reading the bands without alarm',
        body: [
          'The cut-offs — 18.5, 25, 30, 35 and 40 — are round numbers chosen for convenience, and nothing changes about a body as it crosses one. A BMI of 24.9 and a BMI of 25.1 describe almost identical people; only the label changes.',
          'That is why the bands appear here as a plain table with your row marked, rather than as a coloured gauge. A red figure implies a judgement that the arithmetic cannot support.',
          'If the number concerns you, the useful next steps are measurements BMI cannot capture — waist circumference, blood pressure, blood sugar — and a conversation with a doctor who can see the rest of the picture.',
        ],
      },
    ],
    related: ['percentage-calculator', 'unit-converter', 'age-calculator'],
    popular: true,
    isNew: true,
    updated: '2026-09-10',
  },
  {
    slug: 'unit-converter',
    name: 'Unit Converter',
    h1: 'Unit converter',
    tagline: 'Length, weight, temperature and eight more — with the whole category listed underneath.',
    category: 'calculators',
    icon: 'ruler',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'Unit Converter — Length, Weight, More',
    metaDescription:
      'Convert length, weight, temperature, volume, area, speed, time, data, pressure, energy and angle. Shows the amount in every unit of the category at once.',
    primaryKeyword: 'unit converter',
    secondaryKeywords: [
      'cm to inches',
      'kg to lbs',
      'celsius to fahrenheit',
      'metric to imperial',
      'measurement converter',
    ],
    synonyms: [
      'convert units',
      'measurement conversion',
      'imperial to metric',
      'conversion calculator',
      'km to miles',
      'ml to cups',
      'convert temperature',
    ],
    howTo: {
      title: 'How to convert units',
      steps: [
        'Choose what you are measuring — length, weight, temperature and so on.',
        'Type the amount and pick the unit it is in.',
        'Pick the unit you want it in, or press Swap to go the other way.',
        'Read the answer, or the table underneath for every other unit in that category.',
      ],
    },
    features: [
      {
        title: 'Every unit in the category, at once',
        body: 'Under the answer is the same amount in every other unit of that kind. Someone converting a running distance usually wants metres too; someone converting a recipe wants millilitres and cups.',
      },
      {
        title: 'Temperature is handled properly',
        body: 'Every other unit here is a pure ratio. Fahrenheit is not — it has its zero in a different place — so the conversion scales and then shifts. A converter that treats °F as a ratio gets every temperature except −40 wrong, and wrong in a way that looks plausible.',
      },
      {
        title: 'Decimal and binary bytes, both labelled',
        body: 'A kilobyte is 1,000 bytes and a kibibyte is 1,024, which is the entire reason a "500 GB" drive shows up as 465 GB in an operating system. Both are here, each saying which it is.',
      },
      {
        title: 'The reverse is exact',
        body: 'Every conversion goes through the category’s base unit in both directions, so converting back gives you the number you started with rather than something a rounding error away from it.',
      },
      {
        title: 'Real precision, without the noise',
        body: 'Results keep ten significant figures — enough to write 1,609.344 in full — and the floating-point artefacts that make a converter look broken, the 1.0000000000000002, never reach the page.',
      },
      {
        title: 'Nothing is sent anywhere',
        body: 'Every ratio is in the page. There is no lookup, no API and no delay, and it keeps working with no connection.',
      },
    ],
    faq: [
      {
        q: 'How many centimetres are in an inch?',
        a: 'Exactly 2.54, by international agreement since 1959. That definition makes a foot exactly 30.48 cm and a mile exactly 1,609.344 m — these are definitions rather than measurements, which is why the figures here are exact rather than rounded.',
      },
      {
        q: 'Why does my hard drive show less space than it says on the box?',
        a: 'Because two different kilobytes are in play. Storage is sold in decimal units where 1 GB is 1,000,000,000 bytes; most operating systems display binary units where 1 GiB is 1,073,741,824. Nothing is missing — a 500 GB drive is 465 GiB of the same bytes. Both units are in the data category here.',
      },
      {
        q: 'Is a pound a unit of weight or of mass?',
        a: 'Strictly, mass — one pound is exactly 0.45359237 kilograms. In everyday use "weight" and "mass" are used interchangeably on Earth, where the difference does not show up, so both live in the same category here.',
      },
      {
        q: 'Why does converting back not always give a round number?',
        a: 'It should, and here it does: both directions pass through the same base unit, so the round trip returns to where it started. Converters that store one ratio per pair rather than one per unit are where the drift comes from.',
      },
      {
        q: 'Can it convert currency?',
        a: 'No, deliberately. Exchange rates change by the minute and would need a live feed, which would mean sending your figures to a server — the one thing every tool here avoids. Everything in this converter is a fixed physical ratio that will still be true next year.',
      },
    ],
    content: [
      {
        heading: 'Why everything goes through a base unit',
        body: [
          'A category with twelve units has sixty-six possible pairs, and storing a ratio for each is how converters end up disagreeing with themselves — convert kilometres to miles and back, and you land a hair away from where you began.',
          'The fix is to store one number per unit: how much of the base unit it is worth. A conversion is then two operations, into the base and out of it, and the reverse is the same two in the other order. Sixty-six pairs become twelve facts, and the round trip is exact by construction.',
          'Temperature is the one category where that is not quite enough, because Celsius and Fahrenheit do not share a zero. Those units carry an offset that is applied after the scaling, which is why −40 is the single temperature where the two scales agree.',
        ],
      },
      {
        heading: 'The conversions people get wrong',
        body: [
          'Feet and inches are the classic. Five foot nine is 5.75 feet, not 5.9, because nine inches is three quarters of a foot — an error that quietly ruins height conversions and BMI calculations everywhere.',
          'Fluid ounces are worse: a US fluid ounce and an imperial one are different sizes, and so are the pints and gallons built from them. A recipe written in one and cooked in the other is off by about a fifth.',
          'And nautical miles are not miles. A nautical mile is one minute of latitude, 1,852 metres exactly, which is why a boat’s speed in knots is not a car’s speed in miles per hour.',
        ],
      },
    ],
    related: ['bmi-calculator', 'percentage-calculator', 'discount-calculator'],
    popular: true,
    isNew: true,
    updated: '2026-09-10',
  },
  {
    slug: 'discount-calculator',
    name: 'Discount Calculator',
    h1: 'Discount calculator',
    tagline: 'What you actually pay, what you actually save, and why stacked discounts disappoint.',
    category: 'calculators',
    icon: 'scissors',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'Discount Calculator — Sale Price and Tax',
    metaDescription:
      'Work out a sale price with tax, find the percentage off from two prices, or stack discounts. Shows the working, and why 20% then 20% is not 40% off.',
    primaryKeyword: 'discount calculator',
    secondaryKeywords: [
      'percent off calculator',
      'sale price calculator',
      'how much did i save',
      'stacked discounts',
      'price before discount',
    ],
    synonyms: [
      'work out a discount',
      'calculate percent off',
      'sale price with tax',
      'gst calculator',
      'vat calculator',
      'markdown calculator',
      'coupon calculator',
    ],
    howTo: {
      title: 'How to work out a discount',
      steps: [
        'Pick the question you are asking — take a percentage off, find the percentage, work backwards, or stack discounts.',
        'Type the price and the percentage.',
        'Add sales tax, VAT or GST if the price does not already include it.',
        'Read the total, and the working underneath if you want to check it.',
      ],
    },
    features: [
      {
        title: 'Tax on either side of the discount',
        body: 'A shop’s own sale charges tax on the reduced price. A manufacturer’s coupon is taxed on the full price in several US states, because the shop is reimbursed. The two give different totals, so the question is asked rather than assumed.',
      },
      {
        title: 'Stacked discounts, with the honest arithmetic',
        body: 'Twenty per cent off and then another twenty is thirty-six per cent off, not forty — the second discount is charged on what the first one left. Both figures are shown side by side.',
      },
      {
        title: 'Four questions, not one',
        body: 'Take a percentage off a price, find what percentage a "was £80, now £60" ticket represents, work back to the original price from a sale price, or stack several discounts in order.',
      },
      {
        title: '"You save" that includes the tax',
        body: 'When tax follows the discount, the tax on the money you saved is saved too. The saving is measured against the same basket at full price, which is what the question actually means.',
      },
      {
        title: 'Rounded the way a till rounds',
        body: 'Every step is rounded to two decimal places as it goes, so the figures on the page add up exactly rather than approximately — which is what makes them match the receipt.',
      },
      {
        title: 'No currency, on purpose',
        body: 'The arithmetic is identical in rupees, dollars, pounds and euros. Leaving the symbol out means the tool is never wrong about which country you are in.',
      },
    ],
    faq: [
      {
        q: 'Why is 20% off then 20% off not 40% off?',
        a: 'Because the second discount is taken from a smaller number. Twenty per cent off £100 leaves £80, and twenty per cent off £80 is £16, not £20 — so the pair take £36, which is 36% off. The stacking mode shows both numbers so the gap is visible rather than surprising.',
      },
      {
        q: 'Should tax be charged before or after the discount?',
        a: 'Usually after — a shop reducing its own price collects tax on the price it actually charges. The exception is a manufacturer’s coupon in some US states, where the shop is reimbursed for the difference and tax is due on the pre-coupon price. If your receipt disagrees with this calculator, that setting is almost always why.',
      },
      {
        q: 'How do I find the original price from a sale price?',
        a: 'Divide by one minus the discount: £60 after 25% off was £80, because £60 ÷ 0.75 = £80. Subtracting 25% from the sale price instead is the common mistake, and it gives £45. The "Price before the sale" mode does it correctly.',
      },
      {
        q: 'Can I use this for GST or VAT?',
        a: 'Yes. The tax field is a plain percentage, so 18% GST, 20% VAT and 8.25% sales tax all work the same way. Leave it at zero if the price you typed already includes the tax.',
      },
      {
        q: 'Why does "you save" show more than the discount?',
        a: 'Because you also avoid the tax on the amount discounted. Twenty per cent off a £100 item with 20% tax saves £20 of price and £4 of tax — £24 in total, which is what you would really have paid otherwise.',
      },
    ],
    content: [
      {
        heading: 'The percentage that is not the percentage',
        body: [
          'Shops are fond of arrangements that sound larger than they are. "An extra 20% off sale prices" reads as an addition, and it is a multiplication: each discount applies to whatever the last one left, so they compound downwards rather than adding up.',
          'The rule is easy once you see it. Multiply what remains, not what is removed: 20% off leaves 80%, and 80% of 80% is 64% — so 36% has gone, not 40%. Three 10% discounts leave 72.9% and take 27.1%, not 30%.',
          'The gap grows with the size of the discounts. Two 50% discounts leave a quarter of the price rather than nothing at all, which is the version of this arithmetic everyone can check in their head.',
        ],
      },
      {
        heading: 'Working backwards from a sale price',
        body: [
          'The other reliable trap is reversing a discount. If a jacket is £60 after 25% off, its original price was not £75, and it certainly was not £60 plus 25%. The £60 is 75% of the original, so the original is £60 ÷ 0.75 = £80.',
          'The same reasoning undoes tax. A £120 total that includes 20% VAT came from £100, because £120 is 120% of the pre-tax price — dividing by 1.2 recovers it, while taking 20% off £120 gives £96 and is simply wrong.',
          'Both are one division, and both are done in the wrong direction constantly, including on price tags.',
        ],
      },
    ],
    related: ['percentage-calculator', 'unit-converter', 'emi-calculator'],
    isNew: true,
    updated: '2026-09-10',
  },
];
