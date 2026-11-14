import { z } from "zod";

/** Shape of a clinical record as entered by a doctor. Shared by the API and the browser demo. */
export const RecordInput = z.object({
  title: z.string().trim().min(2).max(120),
  diagnosis: z.string().trim().min(2).max(300),
  notes: z.string().trim().max(4000).default(""),
  medications: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  vitals: z
    .object({ bp: z.string().max(12).optional(), pulse: z.number().int().min(20).max(250).optional(), temperature: z.number().min(30).max(45).optional(), spo2: z.number().int().min(50).max(100).optional() })
    .default({}),
});
