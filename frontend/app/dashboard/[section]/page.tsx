"use client";

import { AppClient } from "../../AppClient";

export default function DashboardSectionPage({ params }: { params: { section: string } }) {
  return <AppClient mode="dashboard" initialSection={params.section} />;
}
