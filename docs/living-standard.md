# Living standard on a PhD salary

Opportunity research can include a `data.living_standard` assessment. The app shows it at the top of **Salary & funding**, both for current opportunities and captured application context. Existing application snapshots keep their original assessment until the user refreshes the context.

The baseline is one person renting a private bedroom in a shared flat near the workplace, sharing the kitchen, other communal space and household bills. Assume no dependants, car, guaranteed student housing, student discounts or preferred climate. Use the starting salary, not a later salary step. Count employer pension contributions, research budgets and tuition waivers separately from spendable income.

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

1. Identify the exact opportunity, work location, contract percentage, starting salary, currency, pay period, gross/net basis, funding duration and eligibility. Read its official source. Do not assume an MSCA allowance is the employee's net salary, or an employer pension contribution is cash pay.
2. Check current university or city housing information and the price of a private room in a shared flat. Do not use a shared bedroom, studio or whole-apartment price. State whether the room price includes utilities; split household bills without dividing personal food, transport or insurance costs. Do not assume employed PhDs qualify for subsidised student rooms. Treat a visa maintenance minimum as a legal threshold, not a realistic living budget.
3. Research local culture, outdoor access, university life and climate. Explain each score. Use current official sources where available and retain their links and the assessment date. Mark older salary evidence, broad estimates and source gaps.
4. Use `null` for an unknown factor, including affordability when the offered pay or funding cannot support a defensible comparison. The app shows an incomplete assessment instead of treating unknowns as zero or reweighting the remaining factors. Do not infer a score from an existing fit score or the salary number alone.
5. Label confidence `low`, `medium` or `high`. Use `low` for broad estimates, old salary evidence or uncertain eligibility. For collective-agreement benchmarks, say that the individual starting step and take-home pay still need confirmation. A decimal score does not imply decimal accuracy.
6. Store the object below under `opportunities.data.living_standard` through trusted research tooling. Preserve every other research field, the original salary and the user's reviews. Recheck the stored assessment after writing. Refresh the assessment when salary, work location, funding conditions or relevant costs change. Do not overwrite application snapshots.

```ts
interface LivingStandardAssessment {
  version: 1;
  housing_baseline: 'shared_flat' | 'private_apartment'; // Required for new research; absent legacy records mean private_apartment.
  assessed_at: string; // YYYY-MM-DD
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  salary_basis: string; // Actual offer or explicitly identified benchmark; gross/net and period.
  budget_basis: string; // Local shared-flat room budget and its limitations.
  funding_note?: string; // Eligibility, renewal, uncovered fees, or other conditions.
  factors: Record<'affordability' | 'housing' | 'culture' | 'nature' | 'student_life' | 'climate', {
    score: number | null;
    reason: string;
  }>;
  sources: { title: string; url: string }[];
}
```

The frontend accepts version 1 with valid scores, reasons, date, confidence and at least one safe HTTP(S) source URL. It recomputes the overall score rather than trusting an imported total. Invalid records remain unassessed. The existing JSONB research field supports this contract without a schema migration or new browser write permissions.
