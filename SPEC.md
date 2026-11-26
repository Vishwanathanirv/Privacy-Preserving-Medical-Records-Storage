# MedVault · Spec

## Problem
Records and scans live in separate systems; copies drift and leak; patients can't see who looked or limit access in time.

## Core (MVP)
Seal each record into its own scan, reversibly, with patient-held keys that can be lent for a fixed time and an access log anyone can verify.

## Flow
1. First screen: a real X-ray with a record sealed in it, a lens over the changed pixels, the source and licence
2. Open a wallet as a fictional patient, doctor or admin (one click), or sign in with email and password
3. Patient: wallet of records, care team on/off, lend one record for 15 minutes to a week, emergency card, access trail with in-browser verification
4. Doctor: patients on their care team, records on loan, record view with decryption, bit-exact proof and tamper test
5. Admin: verify the hash chain and signed tree head; cannot read records
6. Responder (`/sos`): open an emergency card with its one-time code, no account; the opening is logged

## Data (SQLite)
| Table | Columns |
| --- | --- |
| users | id, email, name, role (admin, doctor, patient), password_hash, created_at |
| records | id, patient_id, author_id, title, width, height, stego_png, stego_sha256, original_sha256, wrapped_key, stats, scan, created_at |
| grants | patient_id, doctor_id, granted_at |
| loans | id, record_id, patient_id, doctor_id, created_at, expires_at, wrapped_key (destroyed at end), ended_at, end_reason |
| sos_cards | id, patient_id, salt, auth_hash, sealed, created_at, revoked_at |
| audit | seq, ts, actor, action, target, detail, prev_hash, hash |

## Limits
300 requests/min per client overall; login 10/min; record upload 20/min; file verification 10/min.

## States
- Loading: skeletons for pages and sheets; "Sealing…" on the first-screen X-ray.
- Empty: a record not in the wallet says so.
- Errors: failed sign-in shows the reason; a tampered file fails the integrity check and is shown as caught.

## Out of scope
Real patient data, clinical decision support, PACS integration.
