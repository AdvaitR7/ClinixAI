import { and, eq, inArray } from "drizzle-orm";
import { requireDb } from "../http.js";
import { doctors, practiceMembers } from "../schema.js";

/** Doctor ids that belong to a practice through an ACTIVE OWNER/DOCTOR membership. */
export async function practiceDoctorIds(practiceId: string): Promise<string[]> {
  const rows = await requireDb()
    .select({ id: doctors.id })
    .from(practiceMembers)
    .innerJoin(doctors, eq(doctors.profileId, practiceMembers.profileId))
    .where(
      and(
        eq(practiceMembers.practiceId, practiceId),
        eq(practiceMembers.status, "ACTIVE"),
        inArray(practiceMembers.role, ["OWNER", "DOCTOR"]),
      ),
    );
  return rows.map((r) => r.id);
}

