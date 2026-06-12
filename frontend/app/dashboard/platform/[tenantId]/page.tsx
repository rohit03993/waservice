"use client";

import { AppClient } from "../../../AppClient";

export default function PlatformAgentMonitorPage({ params }: { params: { tenantId: string } }) {
  return <AppClient mode="dashboard" initialSection="platform" platformMonitorTenantId={params.tenantId} />;
}
