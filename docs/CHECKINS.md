# Prickle Check-ins: What We Ask and Why

A check-in is a few taps before and after a prickle, answered on the site (the check-in /
check-out modal, Log Progress, Find a Prickle) or in the Slack DMs. Code: `lib/prickle-checkins.ts`
(questions and keys), `lib/prickle-checkin-dms.ts` (Slack), `components/writing/CheckinFields.tsx`
(inputs). Table: `prickle_checkins`, reshaped by migration `20261218000000`.

## Start from the decisions

Every question has to feed a decision someone actually makes. A question that doesn't just adds
friction, and lower response rates make every other answer less useful.

| Decision | Who | Fed by |
|---|---|---|
| Which prickle to suggest, given how a member feels and what they need | Find a Prickle | Mood and feeling coming in, intention, got what they came for |
| Who is quietly struggling, so staff can reach out before they cancel | Staff | Mood coming in over time, got what they came for, who stops answering |
| Which prickle types and hosts deliver value (schedule more, coach, cut) | Staff | Got what they came for, mood change, per series |
| Reflection that builds the writing habit | The member | Naming the feeling, before and after |

## The questions

**Check-in (before):**
1. **Mood**, on the two axes of the circumplex model of affect: *Overall, how do you feel?* (Very
   bad, Bad, Okay, Good, Very good) and *How's your energy?* (Very low, Low, Medium, High, Very
   high). Two labeled 5-point scales.
2. **Name the feeling** *(optional)*: the Feeling Wheel (Willcox, 1982), all three rings. Pick a
   core feeling, then optionally one of its twelve related feelings (its middle ring, then its
   outer ring), or search for any word on the wheel (arrow keys and Enter work) and land on it
   directly. In Slack it's one select grouped by core, so a member picks a core or any of its
   feelings in one step; Slack's select filters as you type.
3. **Intention**: *What do you need most from this session?* (momentum, deep focus,
   accountability, company, unstuck).

**Check-out (after):**
1. **Did you get what you came for?** (Not at all, A little, Somewhat, Mostly, Completely),
   against the intention set at check-in.
2. **Mood** again, same wording and scales.
3. **Name the feeling** again *(optional)*.

A half counts as answered once its required questions are (`checkinAnswered`: mood + intention;
`checkoutAnswered`: got what they came for + mood). The named feeling never blocks it.

## Why these, and not the alternatives

- **"Overall, how do you feel?", not "How pleasant do you feel?"** The dimension is valence
  (pleasure-displeasure), which research calls "pleasantness", but nobody says "I feel
  pleasant". The Feeling Scale (Hardy & Rejeski, 1989), a single-item valence measure widely used
  in exercise psychology and paired with an arousal scale to place answers on the circumplex,
  asks how you feel from "very bad" to "very good". We use those everyday anchors on a 5-point
  version. Energy stays "How's your energy?", the plain-language form of arousal. (The original
  Feeling Scale is 11 points, -5 to +5; we checked its anchors only in secondary sources: an
  open textbook chapter ([Zenko & Jones](https://med.libretexts.org/Bookshelves/Sports_and_Exercise/Essentials_of_Exercise_and_Sport_Psychology__-_An_Open_Access_Textbook_(Zenko_and_Jones)/12%3A_Affective_Responses_to_Exercise-_Measurement_Considerations_for_Practicing_Professionals/12.07%3A_Measuring_Affective_Responses_in_an_Exercise_Setting-_An_Example_Vignette_Revisited))
  and the paper's [bibliographic record](https://www.bisp-surf.de/Record/PU199209059089).)
- **Mood as two scales, not a word list.** The earlier hand-picked list of 11 feelings mixed
  rings of the wheel unevenly: some core, some specific, several from one core, many cores
  missing. A list shapes the answers it gets, and its groups rolled up by how many words each
  had, not by how people felt. Two labeled scales are the same for everyone, equal-interval
  enough to average, and the same question before and after gives a *change*, the session's
  effect on mood.
- **A familiar, balanced wheel, offered whole.** The Feeling Wheel (Willcox, 1982) is popular
  (a community member's favorite, and widely used in therapy and coaching), balanced (three
  pleasant and three unpleasant cores, so it doesn't lean negative) and even (twelve feelings
  per core). It's offered whole, never hand-picked, so every answer rolls up to exactly one core
  (`EMOTION_CORE`). Balance also makes before/after change readable: moving from an unpleasant
  core to a pleasant one means something when the wheel doesn't tilt. We chose it over a
  research-derived taxonomy (Shaver et al., 1987) on purpose: the named feeling is optional and
  mostly for the member's own reflection, while the measurement comes from the mood scales.
  See "Choosing the wheel" below.
- **"Did you get what you came for?" instead of "How did it go?" or per-session NPS.** It's tied
  to the member's own goal for the session, so it's actionable (which prickles serve which
  intentions) rather than a generic satisfaction score. NPS ("would you recommend...?") measures
  the relationship, not a session: asked after every prickle it gets the same 9-10 from
  regulars, adds fatigue, and only hears from people who showed up. Run NPS as a periodic
  relationship survey of all members instead (see below).
- **Labeled 5-point scales.** Every point is labeled, which makes answers more consistent across
  people than bare numbers, and five buttons fit on a phone and in a Slack message.

## The Feeling Wheel (Willcox, 1982)

**Decision:** this is the wheel we use, chosen for being popular, balanced and even over research
derivation (see "Choosing the wheel" below for the comparison). It was designed for therapy
(transactional analysis), with no study behind its categories or words.

Gloria Willcox (1982), "The Feeling Wheel: A Tool for Expanding Awareness of Emotions and
Increasing Spontaneity and Intimacy," *Transactional Analysis Journal* 12(4), 274-276,
doi:[10.1177/036215378201200411](https://doi.org/10.1177/036215378201200411).

All three rings, clockwise from Mad, as used in `EMOTION_WHEEL`:

| Core | Middle ring | Outer ring |
|---|---|---|
| Mad | Hurt, Hostile, Angry, Rage, Hateful, Critical | Jealous, Selfish, Frustrated, Furious, Irritated, Skeptical |
| Scared | Rejected, Confused, Helpless, Submissive, Insecure, Anxious | Bewildered, Discouraged, Insignificant, Weak, Foolish, Embarrassed |
| Joyful | Excited, Vibrant\*, Energetic, Playful, Creative, Aware | Daring, Fascinating, Stimulating, Amused, Extravagant, Delightful |
| Powerful | Proud, Respected, Appreciated, Hopeful, Important, Faithful | Cheerful, Satisfied, Valuable, Worthwhile, Intelligent, Confident |
| Peaceful | Nurturing, Trusting, Loving, Intimate, Thoughtful, Content | Thankful, Sentimental, Serene, Responsive, Relaxed, Pensive |
| Sad | Sleepy, Bored, Lonely, Depressed, Ashamed, Guilty | Apathetic, Inferior, Inadequate, Miserable, Stupid, Bashful |

\* "Sexy" in the original; see below. 6 cores + 72 secondary feelings (36 per ring) = 78 words,
every one under exactly one core.

**From the article itself.** The 1982 article (TAJ 12(4), pp. 274-276) is hosted on the FW 2.0
site's Resources page ([PDF](https://thefeelingswheel.com/wp-content/uploads/2024/09/willcox1982_feelingswheel.pdf)),
and it settles what the reproductions couldn't:
- **The words** in the table above match the wheel printed on p. 276 exactly, with "Sexy" in
  the original.
- **Balance was the point.** She built the cores from four "commonly recognized basic feelings:
  mad, sad, glad, and scared", and "in order to keep the circle of feelings balanced between what
  I think of as primarily pleasant emotions and those which are usually unpleasant, I expanded the
  feeling 'glad' to include 'joyful,' 'powerful' and 'peaceful'" (p. 274).
- **The rings.** "Radiating out from these basic six colors and feelings are words which describe
  secondary feelings related to the center circle root feelings. The outer circles are colored in
  blends of the center circles in decreasing shades of intensity" (p. 274).
- **The outer circle has 72 slots, half of them blank.** "Blank spaces are provided in the outer
  circle in which people can add their own feeling words" (p. 275), and a game has people "pick a
  number between 1 and 72 and count around the circle from a 'given feeling' on the outer layer".
  On p. 276 each middle-ring segment spans two outer slots: one named word and one blank. That's
  the 1:1 pairing the reproductions show (they drop the blanks), and it's why the picker shows each
  middle word with its outer partner. The blanks suggest a natural extra: an "add your own word"
  option.
- **Converting feelings through bridges** (p. 275): "I ask clients to become aware of some of the
  bridges they experience between their feelings and ask them to use these bridges to change
  unwanted feelings into desirable feelings." Her examples, one for each unpleasant core:
  - **Scared → Joyful through Excited:** "to convert scare into joy, clients might bridge through
    excitement" (a roller-coaster line: fear about a task reframed as paying to ride it). Anxious and
    Excited sit side by side where the two cores meet.
  - **Sad → Peaceful through Bored or Sleepy:** "'sadness' can be converted into 'peace' through
    the bridge of 'boredom' or 'sleepiness.'" Sleepy and Content sit side by side where those
    cores meet.
  - **Mad → Powerful:** "Anger can be used to help people become aware of their power and enable
    them to channel its energy into strength and assertiveness." (Mad and Powerful are opposite each
    other on the wheel.)

The three-ring drill-down people expect from feelingswheel.com comes from a different wheel,
Roberts's (below), where each middle word really does branch into two outer ones.

**Watch out for the other "feelings wheel".** A different, 7-core wheel (Happy, Sad, Angry,
Fearful, Bad, Surprised, Disgusted) circulates widely, often also credited to Willcox
([example](https://mcfapa.life/wp-content/uploads/2021/09/FAME-Feelings-Wheel-1.pdf)). It's
Geoffrey Roberts's 2015 wheel, a later adaptation, not her 1982 one: a Mentalyc page says its
layout follows "Geoffrey Roberts's feelings wheel (2015)"
([Mentalyc](https://www.mentalyc.com/therapy-games-and-tools/feelings-wheel)), and Albert Wong
traces Roberts's wheel to a 2014 vocabulary wheel by Kaitlin Robbs, which "appears to be based
on" Willcox's ([Observable](https://observablehq.com/@ajwwong/feelings-wheel); his inference).
Unlike Willcox's, it's a true tree: in the reproduction above, 7 cores branch into 41 middle
words (from 4 under Bad, Disgusted and Surprised to 9 under Happy), and every middle word into
two outer ones, 82 in all: 130 words. feelingswheel.com is commonly described as a digital
version of Roberts's wheel; the site couldn't be loaded to confirm.

**"Vibrant", not "Sexy".** The original Joyful ring has "Sexy"; we use "Vibrant" instead, as the
South Dakota reproduction does, since it fits a writing check-in better. It's the one word we
changed.

### Reproducing it: attribute, don't ask

**Decision:** we credit the wheel everywhere it's shown (`EMOTION_WHEEL_CREDIT`, "Feeling Wheel
by Gloria Willcox (1982)", under the picker in the app; "(Feeling Wheel by Gloria Willcox)" under
the Slack DM question) and are not
seeking permission. What we found:
- The article is © 1982 International Transactional Analysis Association (per the journal's
  [listing on SAGE](https://journals.sagepub.com/doi/abs/10.1177/036215378201200411), seen in a
  search snippet; the page itself couldn't be opened to confirm). The journal is now published
  by Taylor & Francis for the ITAA Foundation
  ([ITAA](https://itaaworld.org/transactional-analysis-journal),
  [Taylor & Francis](https://www.tandfonline.com/journals/rtaj20/about-this-journal)). No public
  reuse terms for the wheel were found.
- Many organizations reproduce it with attribution only (Gottman Institute, a state health
  department, therapy practices), and reproductions carry their own notices for their own
  artwork (e.g. "©Copyright 2020 Common Zen Media Inc & All The Feelz"). None grants rights to
  the original. The [Alexithymia Awareness Network](https://alexithymiaawarenessnetwork.org/wilcox/)
  notes it couldn't establish the wheel's licensing either, and advises checking copyright and
  permissions before reusing a wheel image.
- What we use is the words and their grouping, with no copied artwork. Copyright doesn't cover
  single words, but a selection and arrangement can be protected as a compilation, and this
  selection and grouping is what makes it Willcox's wheel. The residual risk is a request from a
  rights holder to stop; if that happens, replace the grouping with one we write ourselves,
  keeping the same structure (balanced cores, every feeling in exactly one).
- If we ever do want permission, the routes are Taylor & Francis permissions (the article's
  "Rights & Permissions" link on tandfonline.com) and the ITAA.
- This is a reading of the situation, not legal advice.

## Choosing the wheel

### Comparing the options

Shaver et al. (1987) and Parrott (2001) are one option, not two: Parrott's book reprints the
tree Shaver et al. derived, so "Parrott's emotions" is the same taxonomy.

| | Shaver et al. / Parrott | Willcox Feeling Wheel | 7-core "Feelings Wheel" | Junto Emotion Wheel | Plutchik's wheel | Geneva Emotion Wheel |
|---|---|---|---|---|---|---|
| **Year, author** | 1987 study; reprinted 2001 | 1982, a transactional-analysis therapist | 2015, Geoffrey Roberts (via a 2014 wheel by Kaitlin Robbs; the basis of feelingswheel.com) | 2016, The Junto Institute | 1980, Robert Plutchik | 2005, Klaus Scherer (Univ. of Geneva) |
| **How it was made** | **Data:** people sorted 135 emotion words; hierarchical cluster analysis | Clinical judgment, for therapy | Adapted from earlier wheels, apparently Willcox's (unverified lineage) | Practitioners compiling words for team use | Theory (psychoevolutionary) | Research instrument; validated in rating studies |
| **Evidence for the categories** | Strongest of the drill-downs: the groups are what people's sorting produced | None published | None published; includes non-feelings (e.g. "disrespected") | None published | Theoretical; limited, tentative empirical tests | Validated as a self-report measure |
| **Structure** | 6 basic → 25 subordinate → ~135 words; uneven (joy 7, fear 2, surprise 1) | 6 cores, each with 12 secondary feelings across two rings (6 + 6); even | 7 cores → 41 → 82 (each middle word has two outer ones): 130 words; uneven (4 to 9 per core) | 6 cores → 100+ feelings | 8 primaries in opposing pairs × 3 intensities, plus blends (dyads) | 20 emotion families on valence × control, with intensity |
| **Pleasant vs unpleasant cores** | 2 pleasant, 3 unpleasant, 1 neutral | 3 / 3, balanced by design | 1 pleasant (Happy) of 7 | Says it corrects earlier wheels' negative skew | 2 pleasant, 4 unpleasant, 2 neutral-ish | 10 / 10 |
| **Has tired / bored / stressed** | No (not prototypical emotions) | Sleepy, Bored | Yes, under "Bad" (tired, bored, stressed, busy) | Partly | No | No |
| **Drill-down fit** (core → specific, a few taps) | Good (Surprise has nothing below it) | Good | Good, but 7 cores and 3 rings is more to scan | Good | Poor: intensity and blends, not specifics | Poor: one flat ring of 20 |
| **Familiar to members** | Low by name; its six cores are what most modern six-core wheels use | High (therapy, Gottman) | Very high (most-shared wheel online) | Moderate | High as an image | Low outside research |
| **Rights** | Published category names; cite | © 1982 ITAA, no public terms; widely reproduced with attribution | Unclear; many versions with their own notices | © The Junto Institute; terms not checked | Theory free to use; specific artwork copyrighted | Free for non-commercial research only; commercial use needs a licence; don't modify |

**Reading the table.** If the goal is categories that reflect how people actually group emotion
words, Shaver et al. is the only data-derived drill-down. The Geneva wheel is the only one
validated *as a self-report instrument*, but its licence and flat 20-family layout rule it out
for us. Willcox and the 7-core wheel win on familiarity, and they include non-emotion states
(tired, bored, stressed) that Shaver et al. leave out; whether our members need those is
untested. Neither has evidence behind its categories. Plutchik is a theory of
how emotions relate, better for explaining emotions than for naming one in a check-in.

**Why the choice matters less than it looks.** The measurement in a check-in comes from the two
mood scales (pleasantness and energy, before and after), which are research-based whatever the
wheel. Naming the feeling is optional and mostly for the member's own reflection. So the wheel
can be chosen for familiarity and balance rather than evidence without weakening the analysis.
Swapping is a list change in `EMOTION_WHEEL` plus a migration.

**Decision: Willcox.** We prioritized popular, balanced and even over research derivation.
Willcox is the only option with all three: the 7-core wheel is popular but heavily negative (one
pleasant core of seven), Shaver et al. is uneven and leans negative (two pleasant cores of six,
rings from zero to seven), Junto's balance claim is unverified, and Plutchik and the Geneva wheel
don't fit a quick drill-down. Shaver et al. was briefly implemented and never launched.

Sources for this comparison, beyond those above: the 7-core wheel's lineage and the Roberts
attribution ([Observable notebook](https://observablehq.com/@ajwwong/feelings-wheel), an
inference rather than documented history; [The Feelings Wheel app](https://apps.apple.com/app/id6756626873));
Plutchik's structure and the state of its evidence ([survey, arXiv:1808.03137](https://arxiv.org/pdf/1808.03137),
[comparison of circular models, Springer](https://link.springer.com/doi/10.1007/BF00998190));
Junto and the Geneva wheel's purpose
([Junto's history of emotion wheels](https://juntoemotionwheel.com/learn/history-of-the-emotion-wheel));
Geneva wheel terms ([UNIGE](https://www.unige.ch/cisa/gew)). Ring counts for Junto are
approximate, from its published description; the 7-core counts are from the reproduction linked
above, and other versions vary slightly.

### Feelings Wheel 2.0 (Smith, 2023)

Kenneth Smith's *Feelings Wheel 2.0* (2023; [site](https://thefeelingswheel.com/)) keeps Willcox's
wheel, with four words changed (Rage → Enraged, Irritated → Odious, Sexy → Attractive,
Stimulating → Stimulated), and adds a behavior per core, body sensations, and a split between
"action" feelings (Mad, Scared, Joyful) and "thinking" ones (Sad, Peaceful, Powerful)
([free wheel PDF](https://thefeelingswheel.com/wp-content/uploads/2024/09/FW-2.0-Model-with-website-pdf.pdf)).
What matters for our design, in brief:

- **Outer words are the milder form of the middle word beside them** (e.g. Furious → Enraged), so
  the middle/outer pairs the picker shows are meant as pairs.
- **Opposites and bridges.** Each core has an opposite straight across the wheel: Scared ↔
  Peaceful, Mad ↔ Powerful, Sad ↔ Joyful. Willcox's "bridges" become two step-by-step routes
  around the wheel between a feeling and its opposite; if the opposite is out of reach, go through a
  neighbor. The site's anxiety method is one worked example
  ([post](https://thefeelingswheel.com/2025/01/29/steps-for-treating-anxiety-with-fw-2-0/)).
- **Ideas for us (not built):** "moved toward the opposite of how you came in" as an outcome; a
  check-in nudge that shows a feeling's opposite and a neighbor to bridge through, with a short
  recall-a-memory prompt.

Detailed reading notes (the book and the blog) are kept privately, outside this repo.

### Considered: emotion categories (Shaver et al., 1987)

Briefly implemented as the "most research-grounded" option, never launched; replaced by Willcox
for balance and familiarity (see the decision above).

Shaver, P., Schwartz, J., Kirson, D., & O'Connor, C. (1987). Emotion knowledge: Further
exploration of a prototype approach. *Journal of Personality and Social Psychology*, 52(6),
1061-1086. doi:[10.1037/0022-3514.52.6.1061](https://doi.org/10.1037/0022-3514.52.6.1061).
The same tree is reprinted in Parrott (2001), *Emotions in Social Psychology*, which is why
it's often called "Parrott's emotions".

**Why this one.** It's the only feelings-wheel-shaped taxonomy we found that is empirical.
Starting from 135 emotion words, participants sorted them by similarity, and a hierarchical
cluster analysis of the sorts produced six basic-level categories (love, joy, surprise, anger,
sadness, fear) with 25 subordinate categories beneath them, and the individual words beneath
those ([Semantic Scholar](https://www.semanticscholar.org/paper/Emotion-knowledge:-further-exploration-of-a-Shaver-Schwartz/b40c14c6f5d0af2e94275febb0a1f68ea31794e4)).
The authors' own abstract hedges on surprise ("love, joy, anger, sadness, fear, and perhaps,
surprise"). Many popular six-core wheels (e.g. the Junto wheel's love, joy, surprise, anger,
sadness, fear) share these basic emotions.

Basic emotion, then its subordinate categories:

| Basic | Subordinate categories |
|---|---|
| Love | Affection, Lust, Longing |
| Joy | Cheerfulness, Zest, Contentment, Pride, Optimism, Enthrallment, Relief |
| Surprise | *(one subordinate category, also called Surprise)* |
| Anger | Irritation, Exasperation, Rage, Disgust, Envy, Torment |
| Sadness | Suffering, Sadness, Disappointment, Shame, Neglect, Sympathy |
| Fear | Horror, Nervousness |

Surprise's and Sadness's same-named subordinate categories would have been stored as the basic
key (`surprise`, `sadness`): 29 keys in all.

**How this was verified.** The paper is paywalled and wasn't read directly. The tree matches
Wikipedia's table, which cites both Shaver et al. (1987) and Parrott (2001)
([Emotion classification](https://en.wikipedia.org/wiki/Emotion_classification#Parrott's_emotions_by_groups)),
and the placements match an independent table in a research paper's emotion ontology
([TONE, arXiv:2401.06810](https://arxiv.org/pdf/2401.06810)). One label differs between
sources: Wikipedia has "Irritability" where other reproductions have "Irritation". Wikipedia
labels Love's second category "Lust/Sexual desire".

**Known limits (why it lost on balance and evenness).**
- **Uneven rings.** Joy has seven subordinate categories, Fear two, Surprise none. That's what
  the data found, so it isn't evened out. Analysis should roll up to the six basic emotions
  before comparing frequencies.
- **More unpleasant than pleasant.** Two basic emotions are pleasant (love, joy), three
  unpleasant, and surprise is neutral. That reflects the emotion vocabulary studied, not a
  choice; the mood scales are balanced.
- **No tiredness, boredom or "stuck".** The study was about prototypical *emotions*, and those
  states aren't. Whether our members need them is unknown: there's no data yet (the earlier
  hand-picked list included tired, stressed and stuck, but that was a guess too). Tiredness shows
  up on the energy scale; boredom and being stuck don't have a
  slot. If members keep needing them, that's a signal to add a free-text "anything else?" rather
  than to edit the taxonomy.
- **Researcher labels.** Some category names (Zest, Enthrallment, Neglect, Torment) are cluster
  labels more than everyday words. Watch which ones never get picked.

**Rights.** Category names from a published study; citing them would have been enough.

## Analysis plan

- **Within-person first.** People use scales differently, so compare each member to their own
  baseline (Find a Prickle already does this: `WEIGHT_PERSONAL` scores a series by how far it
  beats the member's own average).
- **Per series:** mean "got what they came for" and mean mood change (after minus before, on
  each axis), with a minimum number of distinct members before anything is shown, especially
  anything host-facing (see the visibility entry in `docs/TODO.md`).
- **Retention signals:** low or falling pleasantness coming in, falling "got what they came
  for", and members who stop checking in. People skip when they feel worst, so a missing
  check-in is a signal too.
- **Test the metrics against outcomes:** do mood lift and "got what they came for" predict
  next-month attendance and renewal? If a question doesn't predict anything we act on, cut it.
- **Watch the response rate per question.** If the optional feeling drags down completion of the
  required questions, move it after Save or drop it.

## Relationship NPS (not built yet)

"How likely are you to recommend Quill & Cup to a friend?" (0-10) plus "Why?", sent quarterly
through the notifier to active members and recent cancellations. That's where testimonials and
churn reasons come from. Track it separately from check-ins.

## Open items

- Willcox left blank outer slots "in which people can add their own feeling words": consider an
  optional "add your own word" alongside the wheel (stored separately, not as a wheel key).
- If members keep wanting a feeling the wheel lacks, consider an optional free-text "anything
  else?" rather than editing the wheel.
- Find a Prickle reuses the check-in's "coming in" questions and carries them to the prickle's
  check-in as a prefill (`prickleHref` / `parseCheckinPrefill`).
- The check-ins collected before this reshape were discarded rather than mapped (they hadn't
  been rolled out). Activity-log rows about them (`member_activities`, source
  `prickle_checkins`) were kept.

## References

- Hardy, C. J., & Rejeski, W. J. (1989). Not what, but how one feels: The measurement of affect
  during exercise. *Journal of Sport & Exercise Psychology*, 11, 304-317.
- Parrott, W. (2001). *Emotions in Social Psychology*. Key Readings in Social Psychology.
  Philadelphia: Psychology Press.
- Russell, J. A. (1980). A circumplex model of affect. *Journal of Personality and Social
  Psychology*, 39(6), 1161-1178.
- Scherer, K. R. (2005). What are emotions? And how can they be measured? *Social Science
  Information*, 44(4), 695-729.
- Shaver, P., Schwartz, J., Kirson, D., & O'Connor, C. (1987). Emotion knowledge: Further
  exploration of a prototype approach. *Journal of Personality and Social Psychology*, 52(6),
  1061-1086. https://doi.org/10.1037/0022-3514.52.6.1061
- Willcox, G. (1982). The Feeling Wheel: A tool for expanding awareness of emotions and
  increasing spontaneity and intimacy. *Transactional Analysis Journal*, 12(4), 274-276.
  https://doi.org/10.1177/036215378201200411

Reproductions of the Feeling Wheel used to verify its words (none read from the article itself):
[All The Feelz](https://allthefeelz.app/static/feelz/pdf/the_feeling_wheel_pdf__allthefeelz_dot_app.pdf),
[The Gottman Institute](https://www.gottman.com/wp-content/uploads/2020/04/The-Gottman-Institute_The-Feeling-Wheel.pdf),
[South Dakota Department of Health](https://doh.sd.gov/media/012peoxm/feelings-wheel-wilcox.pdf).
The 7-core adaptation: [example](https://mcfapa.life/wp-content/uploads/2021/09/FAME-Feelings-Wheel-1.pdf).
Journal and publisher: [ITAA](https://itaaworld.org/transactional-analysis-journal),
[Taylor & Francis](https://www.tandfonline.com/journals/rtaj20/about-this-journal),
[SAGE listing](https://journals.sagepub.com/doi/abs/10.1177/036215378201200411).

Sources for the emotion categories: [Wikipedia, Emotion classification](https://en.wikipedia.org/wiki/Emotion_classification#Parrott's_emotions_by_groups)
(table citing Shaver et al. and Parrott), [TONE, arXiv:2401.06810](https://arxiv.org/pdf/2401.06810),
[Semantic Scholar record for Shaver et al.](https://www.semanticscholar.org/paper/Emotion-knowledge:-further-exploration-of-a-Shaver-Schwartz/b40c14c6f5d0af2e94275febb0a1f68ea31794e4).
Other wheels: [Geneva Emotion Wheel (UNIGE)](https://www.unige.ch/cisa/gew),
[Junto's history of emotion wheels](https://juntoemotionwheel.com/learn/history-of-the-emotion-wheel).
