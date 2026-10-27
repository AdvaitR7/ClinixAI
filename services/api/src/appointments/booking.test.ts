import Fastify, { type FastifyInstance } from "fastify";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appointmentRoutes } from "./routes.js";
import { availabilityRoutes } from "../availability/routes.js";
import { appointments, doctors, encounters } from "../schema.js";

const mocks = vi.hoisted(() => ({
  database: {
    select: vi.fn(),
    transaction: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("../db.js", () => ({ db: mocks.database }));
vi.mock("../auth/guards.js", () => ({
  requirePatient: () => "patient-own",
  requireDoctor: () => "doctor-own",
}));
vi.mock("./map.js", () => ({
  patientNames: async () => new Map(),
  appointmentView: (value: unknown) => value,
}));
const doctorId = "bc9580c8-6f09-4442-a291-ef316bc30d3f";
const patientId = "patient-own";
const start = new Date("2099-10-26T10:00:00+05:30");
const end = new Date(start.getTime() + 1800000);
const payload = {
  doctor_id: doctorId,
  appointment_type: "IN_PERSON",
  scheduled_start: start.toISOString(),
};
const availability = {
  slotDurationMinutes: 30,
  weeklyTemplate: [
    { day_of_week: start.getUTCDay(), start_time: "10:00", end_time: "12:00" },
  ],
};
const visit = {
  id: "visit-own",
  doctorId,
  patientId,
  encounterId: null,
  appointmentType: "IN_PERSON",
  status: "CONFIRMED",
  scheduledStart: start,
  scheduledEnd: end,
  reason: null,
};

/** Exercises real booking/availability handlers and captured SQL with synthetic database results. */
describe("booking and appointment state boundaries", () => {
  let app: FastifyInstance;
  let rows: unknown[][];
  let writes: { table: unknown; values: Record<string, unknown> }[];
  let conditions: { table: unknown; sql: string; params: unknown[] }[];
  let locks: number;
  let auth: { role: "PATIENT" | "DOCTOR"; patientId: string; doctorId: string };
  const dialect = new PgDialect();
  beforeEach(async () => {
    vi.clearAllMocks();
    rows = [];
    writes = [];
    conditions = [];
    locks = 0;
    auth = { role: "PATIENT", patientId, doctorId: "doctor-own" };
    mocks.database.select.mockImplementation(() => {
      let table: unknown;
      const builder = {
        from: (value: unknown) => {
          table = value;
          return builder;
        },
        innerJoin: () => builder,
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          conditions.push({ table, ...dialect.sqlToQuery(condition) });
          const result = Object.assign(Promise.resolve(rows.shift() ?? []), {
            limit: () => result,
            orderBy: () => result,
            for: () => {
              locks++;
              return result;
            },
          });
          return result;
        },
      };
      return builder;
    });
    mocks.database.transaction.mockImplementation(
      (run: (tx: unknown) => unknown) => run(mocks.database),
    );
    mocks.database.insert.mockImplementation((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        writes.push({ table, values });
        return { returning: async () => [{ ...visit, ...values }] };
      },
    }));
    mocks.database.update.mockImplementation((table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        writes.push({ table, values });
        return { where: async () => [] };
      },
    }));
    app = Fastify();
    app.addHook("onRequest", async (req) => {
      req.auth = {
        ...auth,
        profileId: "profile-own",
        supabaseUserId: "user-own",
      };
    });
    await app.register(appointmentRoutes);
    await app.register(availabilityRoutes);
  });
  afterEach(async () => {
    await app.close();
  });

  it("books a published future slot with no optional reason and locks capacity before reading it", async () => {
    rows = [[{ id: doctorId }], [], [availability], []];
    const response = await app.inject({
      method: "POST",
      url: "/patients/self/appointments",
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(locks).toBe(1);
    expect(writes).toContainEqual({
      table: appointments,
      values: expect.objectContaining({
        status: "REQUESTED",
        appointmentType: "IN_PERSON",
        reason: null,
        scheduledEnd: end,
        paymentStatus: "UNPAID",
      }),
    });
    expect(conditions[0].table).toBe(doctors);
    expect(
      conditions.find((entry) => entry.sql.includes('"scheduled_end" >'))
        ?.params,
    ).toContain(start.toISOString());
  });
  it("preserves the reviewed online mode and trims the reason", async () => {
    rows = [[{ id: doctorId }], [], [availability], []];
    const response = await app.inject({
      method: "POST",
      url: "/patients/self/appointments",
      payload: {
        ...payload,
        appointment_type: "ONLINE",
        reason: " Synthetic reason ",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(writes[0].values).toMatchObject({
      appointmentType: "ONLINE",
      reason: "Synthetic reason",
    });
  });
  it("replays only the patient's matching request without duplicating it", async () => {
    rows = [[{ id: doctorId }], [visit]];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/patients/self/appointments",
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(conditions[1].params).toContain(patientId);
    expect(writes).toHaveLength(0);
  });
  it("does not silently replace the reviewed details with a different existing booking", async () => {
    rows = [[{ id: doctorId }], [{ ...visit, appointmentType: "ONLINE" }]];
    const response = await app.inject({
      method: "POST",
      url: "/patients/self/appointments",
      payload,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("BOOKING_EXISTS");
    expect(writes).toHaveLength(0);
  });
  it("rejects a consent that is not active for this doctor before booking", async () => {
    rows = [[]];
    const response = await app.inject({
      method: "POST",
      url: "/patients/self/appointments",
      payload: { ...payload, consent_id: "9f4d2a31-7a3b-4c52-8f43-6d0f1c0d9e11" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CONSENT_INVALID");
    expect(mocks.database.transaction).not.toHaveBeenCalled();
  });
  it("still refuses unsupported packet ids instead of silently ignoring them", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/patients/self/appointments",
      payload: { ...payload, packet_id: "x" },
    });
    expect(response.statusCode).toBe(409);
    expect(mocks.database.transaction).not.toHaveBeenCalled();
  });
  it.each(["nonsense", "2020-01-01T10:00:00Z"])(
    "rejects invalid or expired time %s",
    async (scheduled_start) => {
      rows = [[{ id: doctorId }], []];
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/patients/self/appointments",
            payload: { ...payload, scheduled_start },
          })
        ).statusCode,
      ).toBe(400);
      expect(writes).toHaveLength(0);
    },
  );
  it("rejects an encounter that does not belong to this patient", async () => {
    rows = [[{ id: doctorId }], []];
    const response = await app.inject({
      method: "POST",
      url: "/patients/self/appointments",
      payload: { ...payload, encounter_id: doctorId },
    });
    expect(response.statusCode).toBe(404);
    expect(conditions[1].table).toBe(encounters);
    expect(conditions[1].params).toContain(patientId);
    expect(writes).toHaveLength(0);
  });
  it("rejects an unknown doctor", async () => {
    rows = [[]];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/patients/self/appointments",
          payload,
        })
      ).statusCode,
    ).toBe(404);
    expect(writes).toHaveLength(0);
  });
  it("rejects unpublished and off-grid availability", async () => {
    rows = [[{ id: doctorId }], [], []];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/patients/self/appointments",
          payload,
        })
      ).statusCode,
    ).toBe(409);
    rows = [[{ id: doctorId }], [], [availability], []];
    const response = await app.inject({
      method: "POST",
      url: "/patients/self/appointments",
      payload: {
        ...payload,
        scheduled_start: new Date(start.getTime() + 900000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(409);
    expect(writes).toHaveLength(0);
  });
  it("blocks a partial interval overlap, including a legacy null-end row", async () => {
    for (const scheduledEnd of [end, null]) {
      rows = [
        [{ id: doctorId }],
        [],
        [availability],
        [
          {
            ...visit,
            scheduledStart: new Date(start.getTime() - 900000),
            scheduledEnd,
          },
        ],
      ];
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/patients/self/appointments",
            payload,
          })
        ).statusCode,
      ).toBe(409);
    }
    expect(writes).toHaveLength(0);
  });
  it.each(["COMPLETED", "NO_SHOW"])(
    "refuses cancellation of %s records",
    async (status) => {
      rows = [[{ ...visit, status }]];
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/appointments/visit-own/cancel",
          })
        ).statusCode,
      ).toBe(409);
      expect(writes).toHaveLength(0);
    },
  );
  it.each(["REQUESTED", "CONFIRMED"])(
    "allows an owned %s cancellation",
    async (status) => {
      rows = [[{ ...visit, status }]];
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/appointments/visit-own/cancel",
          })
        ).statusCode,
      ).toBe(200);
      expect(locks).toBe(1);
      expect(writes[0].values.status).toBe("CANCELLED");
    },
  );
  it("makes cancellation replay idempotent but denies a foreign appointment", async () => {
    rows = [[{ ...visit, status: "CANCELLED" }]];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/appointments/visit-own/cancel",
        })
      ).statusCode,
    ).toBe(200);
    rows = [[{ ...visit, patientId: "foreign" }]];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/appointments/foreign/cancel",
        })
      ).statusCode,
    ).toBe(403);
    expect(writes).toHaveLength(0);
  });
  it("permits the responsible doctor and denies an unrelated doctor", async () => {
    auth.role = "DOCTOR";
    rows = [[{ ...visit, doctorId: "doctor-own" }]];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/appointments/visit-own/cancel",
        })
      ).statusCode,
    ).toBe(200);
    rows = [[visit]];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/appointments/visit-own/cancel",
        })
      ).statusCode,
    ).toBe(403);
  });
  it("cannot resurrect a cancelled appointment through doctor confirmation", async () => {
    rows = [[{ ...visit, doctorId: "doctor-own", status: "CANCELLED" }]];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/doctor/appointments/visit-own/confirm",
        })
      ).statusCode,
    ).toBe(409);
    expect(writes).toHaveLength(0);
  });
  it("confirms a requested appointment once and replays a confirmed one", async () => {
    rows = [[{ ...visit, doctorId: "doctor-own", status: "REQUESTED" }]];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/doctor/appointments/visit-own/confirm",
        })
      ).statusCode,
    ).toBe(200);
    expect(writes[0].values.status).toBe("CONFIRMED");
    writes = [];
    rows = [[{ ...visit, doctorId: "doctor-own" }]];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/doctor/appointments/visit-own/confirm",
        })
      ).statusCode,
    ).toBe(200);
    expect(writes).toHaveLength(0);
  });
  it("cannot finalize clinical records after cancellation", async () => {
    const cancelled = {
      ...visit,
      doctorId: "doctor-own",
      encounterId: "encounter-own",
      status: "CANCELLED",
    };
    rows = [[cancelled], [cancelled]];
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/doctor/appointments/visit-own/complete",
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    expect(writes).toHaveLength(0);
    expect(conditions.some((c) => c.table === encounters)).toBe(false);
  });
  it("returns early-morning India slots and uses persisted booking end times", async () => {
    const day = "2099-10-26";
    rows = [
      [
        {
          slotDurationMinutes: 30,
          weeklyTemplate: [
            {
              day_of_week: start.getUTCDay(),
              start_time: "00:00",
              end_time: "01:00",
            },
          ],
        },
      ],
      [],
    ];
    const response = await app.inject({
      method: "GET",
      url: `/doctors/${doctorId}/availability?from=${day}&to=${day}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().slots[0].start).toBe("2099-10-25T18:30:00.000Z");
    rows = [[{ slotDurationMinutes: 30, weeklyTemplate: [{ day_of_week: start.getUTCDay(), start_time: "00:00", end_time: "01:00" }] }], [{ scheduledStart: new Date("2099-10-25T18:30:00.000Z"), scheduledEnd: new Date("2099-10-25T19:15:00.000Z") }]];
    const occupied = await app.inject({ method: "GET", url: `/doctors/${doctorId}/availability?from=${day}&to=${day}` });
    expect(occupied.json().slots).toEqual([]);
  });
  it("does not return slots from the past", async () => {
    rows = [
      [
        {
          slotDurationMinutes: 30,
          weeklyTemplate: [
            { day_of_week: 3, start_time: "10:00", end_time: "12:00" },
          ],
        },
      ],
      [],
    ];
    const response = await app.inject({
      method: "GET",
      url: `/doctors/${doctorId}/availability?from=2020-01-01&to=2020-01-01`,
    });
    expect(response.json().slots).toEqual([]);
  });
  it.each([
    "from=bad&to=2099-01-01",
    "from=2099-02-01&to=2099-01-01",
    "from=2099-01-01&to=2101-01-01",
  ])("rejects invalid availability ranges %s", async (query) => {
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/doctors/${doctorId}/availability?${query}`,
        })
      ).statusCode,
    ).toBe(400);
    expect(conditions).toHaveLength(0);
  });
});
