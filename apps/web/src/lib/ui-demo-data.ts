export type DemoSection<T> = Readonly<{
  demo: true;
  label: "Preview" | "Demo data";
  data: Readonly<T>;
}>;

export const patientDashboardDemo = {
  demo: true,
  label: "Preview",
  data: {
    carePlanProgress: 33,
  },
} as const satisfies DemoSection<{ carePlanProgress: number }>;
