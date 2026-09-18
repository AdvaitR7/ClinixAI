# CliniX UI Prototype

A clickable frontend prototype for the CliniX AI patient + doctor platform.

## Run

Open `index.html` directly in a browser, or serve the folder locally:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## Included flows

- Patient dashboard
- Structured new-concern assessment
- Longitudinal health timeline
- Reports and lab records
- Medication history
- Doctor relationships
- Appointments
- Privacy / consent / access ledger
- Doctor dashboard
- Doctor appointments
- Patient directory
- Prescription draft review queue
- Prescriptions and follow-ups
- Patient ↔ doctor demo role switch
- Responsive mobile sidebar

## Notes

This is a visual/interaction prototype with synthetic demo data. It intentionally keeps the AI as a structured assistance layer instead of a chat-first interface. Production implementation should connect these screens to the Fastify `/api/v1` backend, Clerk (login) + Supabase PostgreSQL/Storage, and the consent/audit model described in the architecture specifications.
