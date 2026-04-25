# Risk Scoring Review

Date: 2026-04-25

This score is an internal advisor review signal. It is not an automatic approval, denial, or pricing decision.

## Research Takeaways

1. Credit scoring is best understood as a statistical estimate of repayment/default risk, not a moral judgment about the applicant.
2. For small-dollar and microfinance-style lending, useful signals tend to cluster around repayment capacity, existing obligations, verifiable income/cash flow, loan structure, applicant contactability, and documentation quality.
3. Alternative data can improve access for people with thin credit files, but it must be explainable, relevant to financial conduct, and monitored for errors or unintended discrimination.
4. A fixed hand-built score is acceptable as a starter triage score, but the better long-term model is dynamic: track actual repayment outcomes, test which factors predict repayment in this portfolio, and recalibrate weights with local data.

## Current Questions

Keep:
- Full name: needed for file identity.
- Age: useful for adult/legal-capacity screening, but should not add positive score points.
- Personal phone: useful for contactability.
- Debt with similar lender: relevant to repayment risk and over-indebtedness.
- Job name, work address, work phone: useful for employment/contact verification.
- Income proof available and uploaded proof: relevant to income verification.
- Years at job: useful stability signal.
- Home address and years at home: useful stability/contact signal.
- Home owner / address proof name: useful only as a weak verification signal, not a strong ownership reward.
- Documents: should be part of the score because they verify identity, address, residence, and income.

Change:
- Average income should ask for a period: weekly, biweekly, or monthly.
- Desired loan amount should be collected so payment capacity can compare income to the actual weekly payment, not a generic maximum.

De-emphasize/remove from score:
- Marital status: weak, sensitive, and not directly tied to repayment capacity.
- Age positive points: use only for minimum eligibility/adult review, not score advantage.

Add later:
- Income frequency: weekly/biweekly/monthly.
- Other current weekly/biweekly debt payments.
- Whether income is fixed salary, variable, or self-employed.
- Optional rent/payment obligations if the business wants a stronger affordability score.
- Desired loan amount: 2000/3000/4000/5000, but not yet.

Added 2026-04-25:
- Income frequency is now asked separately.
- Main income type is collected with the work question/follow-up.
- Extra household income is collected, with a smart path for full answers like "sí, mi esposo gana 8000 a la semana".
- Current debt payments are collected and subtracted from estimated weekly household income.

## V2 Fixed Score

The v2 fixed score uses the current database fields and document fields.

Total: 100 points

- 25 Payment capacity from net declared household income.
- 20 Income verification.
- 15 Employment stability and work verifiability.
- 15 Residence stability and address consistency.
- 15 Existing lender debt exposure.
- 10 Identity/document completeness.

This is intentionally more conservative than the old score because documents and repayment capacity now matter more, while marital status and age no longer add points. Payment capacity now considers primary income, extra household income when declared, and current debt payments.

## Future Dynamic Model

Once enough repayment history exists, store outcomes:
- paid on time
- days late
- renewed
- partial/default
- collections needed
- advisor override reason

Then replace hand weights with a simple, explainable model first:
- logistic regression or scorecard
- train/test split
- AUC/KS plus calibration
- monitor adverse/unexpected patterns
- keep human review for edge cases
