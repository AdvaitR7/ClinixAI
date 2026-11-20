# Demo rehearsal (Milestones A, B, C)

A manual end-to-end walkthrough for your own instance using the synthetic seed personas.

Last verified: 2026-11-18.

**Setup:** run the API, worker and web app ([local-dev.md](local-dev.md)) and `npm run seed`. Every demo account uses `SEED_DEMO_PASSWORD`. Set `DEMO_REPLAY=replay` on the worker to use matching fixtures; replay misses still require a live gateway. Use the installed PWA on a phone for the patient and a laptop browser for the doctor. Run B before A.

## B: AI check-in

1. **Persona A:** sign in as `ananya.krishnan@demo.clinix.test`.
   - Home shows the upcoming cough follow-up.
   - Timeline shows the cough visit, the amoxicillin prescription and the lab report.
   - Medications shows amoxicillin discontinued with the rash.
   - Vault opens the lab PDF and the prescription photo.
2. **Check-in:** concern `Recurring dry cough for 4 days`. Answer **4–7 days**, then **Moderate · interfering with normal routine**, then **Sore throat or nasal congestion**. Start analysis.
3. **Result:** it should ask for doctor review, show a historical match to the earlier cough visit, and warn that prior treatment does not authorize reuse. The evidence shows the amoxicillin caution.
4. **Persona B** (`rohan.mehta@…`):
   - Vault: the HbA1c trend goes 8.4 → 7.0. Medications: metformin is current.
   - Check-in concern `Increased thirst and tiredness for two weeks`. Answer **More than a week**, then **Mild · manageable, minor discomfort**, then **Unusual tiredness or body aches**.
5. **Persona C** (`sunita.verma@…`): concern `Crushing chest pain radiating to left arm and unable to breathe`. The safety interrupt (`emergency.json`) blocks the flow, shows the emergency number and calls no model.

The scripted version is `node services/api/demo-checkin.mjs a|b|c`. It needs the API and worker running.

## A: Clinical loop

1. **Persona A:** Care → share with Dr. Kavita Rao. Pick the check-in result and create the permission.
2. **Doctor** (`kavita.rao@…`): schedule → appointment → consultation. AI assistance is visible only because of the consent, and it is a draft aid.
3. **Prescription:** create a draft, review every line, finalize. The result is version 1 and immutable; any change creates version 2.
4. **Persona A:** open the prescription from Medications. Then open Privacy: the ledger shows the doctor's access, and **View receipt** opens the access receipt.
5. **Staff** (`priya.nair@…`): Patients → Add patient. Register a synthetic patient for Dr. Rao, **Send claim invitation** (the code is shown once), then **Book appointment**.

## C: Documents and OCR

1. **Lab report:** as Persona A, Vault → Upload `services/api/fixtures/lab_synthetic.pdf`. With replay on, the extraction is labelled `replay:`. Low-confidence values go to review.
2. **Report:** open it to see the observations and reference ranges. Confirm one value, and the trend updates.
3. **Prescription photo:** as the doctor, upload `services/api/fixtures/rx_synthetic.png` for the patient.
   - The draft lands in the queue as `NEEDS_REVIEW`.
   - Correct one field and review it.
   - Finalize only after the review gate. Without the review, the server returns `REVIEW_REQUIRED`.

Recording and the real-phone install are human steps ([../status.md](../status.md)).
