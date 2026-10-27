# Living standard on a PhD salary

Opportunity research can include a `data.living_standard` assessment. The app shows it at the top of **Salary & funding**, both for current opportunities and captured application context. Existing application snapshots keep their original assessment until the user refreshes the context.

The baseline is one person renting a private bedroom in a shared flat near the workplace, sharing the kitchen, other communal space and household bills. Assume no dependants, car, guaranteed student housing, student discounts or preferred climate. Use the mean of an advertised salary range or stated progression, rather than only the starting salary. Count employer pension contributions, research budgets and tuition waivers separately from spendable income.

Store `housing_baseline: 'shared_flat'` on every new assessment. Changing the housing assumption requires reassessing rent, affordability and the room search; it must not merely change the displayed label. Legacy version-1 assessments without this field used a private apartment and retain that assumption, including in existing application snapshots.

| Factor | Weight | What to assess |
| --- | ---: | --- |
| Salary & affordability | 50% | Take-home pay relative to room rent, a share of household bills, food, transport, mandatory insurance and uncovered fees; room for savings and leisure. |
| Room search | 15% | Availability of shared-flat rooms, competition, flatmate selection, deposits, landlord requirements and realistic commuting options. A higher score means an easier search. |
| Culture | 10% | Accessible cultural activities, music, museums and events within the available budget. |
| Nature | 10% | Access to parks, coast, lakes, mountains and outdoor activities without assuming a car. |
| Student life | 10% | University community, clubs, doctoral networks and opportunities to meet people. |
| Climate | 5% | Everyday comfort, daylight, seasonal extremes and weather disruption. Do not equate warmer weather with a better climate. |

Give each factor a score from 0 to 10 and a short reason. The app calculates the weighted mean and displays one decimal. It labels 8–10 very good, 6.5–7.9 good, 5–6.4 manageable, 3–4.9 difficult and below 3 poor. These are comparison judgments under the stated baseline, not measured city rankings. The separate salary verdict uses only the affordability score.

## Research and update instructions

1. Identify the exact opportunity, work location, contract percentage, salary, currency, pay period, gross/net basis, funding duration and eligibility. Read its official source. An empty city field is not missing location evidence: use the named university's city, preferring the advertised campus, department or workplace over its headquarters. Verify the campus from an institutional source and describe the inference in `budget_basis`. For multiple possible workplaces, use a clearly labelled host scenario or range; do not silently choose an arbitrary city.
   - For an experience-dependent salary range, use the arithmetic midpoint of its lower and upper bounds. For annual steps, use their arithmetic mean when the periods are equal, or a duration-weighted mean when unequal. If only starting and final amounts are known, use their midpoint and state that intermediate steps are unavailable. For a stated percentage increase, calculate each funded year's amount before taking the mean. Do not invent an upper bound when a salary is only “from” an amount.
   - Normalize currency, pay period, gross/net basis and contract percentage before averaging. Show the original range or steps and the calculation in `salary_basis`; do not replace the original salary research. State fixed holiday/year-end cash supplements separately. Do not assume an MSCA employer allowance is the employee's net salary, or an employer pension contribution is cash pay.
   - When the vacancy omits the amount, research its institutional doctoral pay scale, collective agreement, scholarship or national funding rate. Use the mean of the applicable range as an explicitly labelled provisional benchmark. If the exact grade, experience step or contract percentage is unresolved, disclose the scenario and use low confidence rather than withholding a comparison solely for that reason. Never present a benchmark as a confirmed offer.
   - For company roles with no published pay or demonstrably applicable pay scale, leave affordability unscored. Do not substitute a public-sector university salary for an unknown company offer. An institutional affiliation alone does not establish the employer's pay scale, especially for industrial PhDs and overseas research centres.
2. Check current university or city housing information and the price of a private room in a shared flat. Do not use a shared bedroom, studio or whole-apartment price. State whether the room price includes utilities; split household bills without dividing personal food, transport or insurance costs. Do not assume employed PhDs qualify for subsidised student rooms. Treat a visa maintenance minimum as a legal threshold, not a realistic living budget.
3. Research local culture, outdoor access, university life and climate. Explain each score. Use current official sources where available and retain their links and the assessment date. Mark older salary evidence, broad estimates and source gaps.
4. Complete a provisional assessment whenever location and pay can be reasonably established from the opportunity, its university/campus or a sourced funding benchmark. Missing literal city text, an unpublished individual salary step, experience-dependent pay, future increases or competitive funding are not by themselves reasons to omit a score. Assess competitive funding conditionally on receiving the stated award and explain eligibility, fee gaps and funding risk in `funding_note`. Use sourced local evidence to estimate all six factors, labelling uncertainty instead of requiring perfect data. Reserve `null` for a factor that still has no defensible basis after these checks; explain the specific unresolved evidence. Leave an opportunity unassessed only when research cannot establish a usable location or any defensible pay/funding scenario. The app shows genuinely incomplete assessments instead of treating unknowns as zero or reweighting the remaining factors. Do not infer a score from an existing fit score or the salary number alone.
5. Label confidence `low`, `medium` or `high`. Use `low` for broad estimates, inferred or ambiguous campuses, old salary evidence, benchmark pay or uncertain eligibility. For collective-agreement benchmarks, say that the individual step, contract percentage and take-home pay still need confirmation. An inferred university city with a verified campus need not lower otherwise strong evidence. A decimal score does not imply decimal accuracy.
6. Store the object below under `opportunities.data.living_standard` through trusted research tooling. Preserve every other research field, the original salary and the user's reviews. Recheck the stored assessment after writing. Refresh the assessment when salary, work location, funding conditions or relevant costs change. Do not overwrite application snapshots.

```ts
interface LivingStandardAssessment {
  version: 1;
  housing_baseline: 'shared_flat' | 'private_apartment'; // Required for new research; absent legacy records mean private_apartment.
  assessed_at: string; // YYYY-MM-DD
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  salary_basis: string; // Actual offer or labelled benchmark; mean calculation, gross/net and period.
  budget_basis: string; // Work city (including university/campus inference), local shared-room budget and limitations.
  funding_note?: string; // Eligibility, renewal, uncovered fees, or other conditions.
  factors: Record<'affordability' | 'housing' | 'culture' | 'nature' | 'student_life' | 'climate', {
    score: number | null;
    reason: string;
  }>;
  sources: { title: string; url: string }[];
}
```

The frontend accepts version 1 with valid scores, reasons, date, confidence and at least one safe HTTP(S) source URL. It recomputes the overall score rather than trusting an imported total. Invalid records remain unassessed. The existing JSONB research field supports this contract without a schema migration or new browser write permissions.
