"use client";

import { useRouter } from "next/navigation";
import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Tag = {
  id: string;
  name: string;
  created_at: string;
};

type MessagingWindow = {
  is_open: boolean;
  last_inbound_at: string | null;
  expires_at: string | null;
  seconds_remaining: number | null;
  can_send_session: boolean;
  can_send_template: boolean;
  session_hint: string;
};

type Contact = {
  id: string;
  phone_e164: string;
  name: string | null;
  custom_attributes: Record<string, unknown>;
  tags: Tag[];
  created_at: string;
  updated_at: string;
  merged_with_existing?: boolean;
  messaging_window?: MessagingWindow;
};

type CampaignRecipient = {
  id: string;
  contact_id: string;
  state: string;
  last_error?: string | null;
  sent_at?: string | null;
  created_at: string;
};

type CampaignCostEstimate = {
  recipient_count: number;
  billable_messages: number;
  open_window_free_messages?: number;
  rate_per_message_inr: number;
  estimated_total_inr: number;
  currency: string;
  template_category: string | null;
  pricing_model: string;
  rate_note: string;
  disclaimer: string;
};

type Campaign = {
  id: string;
  name: string;
  campaign_type: string;
  template_name: string | null;
  template_language: string | null;
  message_text: string | null;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  recipients: CampaignRecipient[];
  cost_estimate?: CampaignCostEstimate | null;
};

type TemplateItem = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  preview_text?: string | null;
  body_variables?: string[];
};

type ConversationItem = {
  conversation_id: string;
  contact_id: string;
  contact_name: string | null;
  phone_e164: string;
  updated_at: string;
  tags?: Tag[];
  messaging_window?: MessagingWindow;
};

type ConversationMessage = {
  id: string;
  direction: string;
  wamid: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type MetaPricingPoint = {
  start: number;
  end: number;
  cost: number | null;
  volume: number | null;
  country?: string | null;
  pricing_category?: string | null;
  pricing_type?: string | null;
  tier?: string | null;
  phone_number?: string | null;
};

type MetaPricingResponse = {
  waba_id: string;
  connection_id: string | null;
  connection_label: string | null;
  disclaimer: string;
  fetched_at: string;
  start_ts: number;
  end_ts: number;
  granularity: string;
  summary_total_cost: number;
  summary_total_volume: number;
  data_points: MetaPricingPoint[];
};

type TagPerformanceRow = {
  tag_id: string;
  tag_name: string;
  contact_count: number;
  messages_sent: number;
  messages_failed: number;
  messages_pending: number;
  estimated_cost_inr: number;
  currency: string;
};

type TagPerformanceResponse = {
  fetched_at: string;
  start_ts: number | null;
  end_ts: number | null;
  summary_messages_sent: number;
  summary_messages_failed: number;
  summary_estimated_cost_inr: number;
  currency: string;
  disclaimer: string;
  tags: TagPerformanceRow[];
};

type PlatformMetaHealth = {
  overall: string;
  token_valid: boolean;
  token_error: string | null;
  token_alert?: string | null;
  token_alert_message?: string | null;
  connection_active: boolean;
  phone_number_id?: string;
  display_phone_number?: string | null;
  verified_name?: string | null;
  connection_label?: string;
  hints: string[];
};

type PlatformTenantRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  setup_status: string;
  agent_email: string | null;
  agent_full_name: string | null;
  agent_is_active: boolean | null;
  created_at: string;
  users: Array<{ email: string; full_name: string | null; role: string; is_active: boolean }>;
  contact_count: number;
  message_count: number;
  whatsapp_connections: number;
  meta_health: PlatformMetaHealth | null;
};

type PlatformAgentOverview = {
  read_only: boolean;
  tenant: {
    id: string;
    name: string;
    slug: string;
    setup_status: string;
    created_at: string;
  };
  agent: {
    email: string;
    full_name: string | null;
    is_active: boolean;
  };
  meta_health: PlatformMetaHealth | null;
  whatsapp: {
    connections_count: number;
    phone_number_id: string | null;
    display_phone_number: string | null;
    verified_name: string | null;
    connection_label: string | null;
    waba_id: string | null;
  };
  metrics: {
    contacts_total: number;
    conversations_total: number;
    active_service_windows: number;
    messages_total: number;
    messages_inbound: number;
    messages_outbound: number;
    messages_sent_today: number;
    messages_received_today: number;
    messages_by_day: Array<{ date: string | null; inbound: number; outbound: number }>;
    templates_total: number;
    templates_approved: number;
    templates_pending: number;
    templates_other: number;
    campaigns_total: number;
    campaigns_by_status: Record<string, number>;
    campaign_recipients_sent: number;
    tags_total: number;
    integration_keys: number;
    last_message_at: string | null;
    last_inbound_at: string | null;
  };
  templates: TemplateItem[];
  recent_conversations: ConversationItem[];
};

type MonitorMessage = {
  id: string;
  direction: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type MeProfile = {
  is_super_admin?: boolean;
  allow_open_registration?: boolean;
  memberships?: Array<{ setup_status?: string }>;
};

function dashboardLandingSection(me: MeProfile): DashboardSection {
  if (me.is_super_admin) return "platform";
  if (me.memberships?.[0]?.setup_status === "pending_meta") return "settings";
  return "contacts";
}

type DashboardSection =
  | "contacts"
  | "campaigns"
  | "templates"
  | "inbox"
  | "settings"
  | "analytics"
  | "automations"
  | "integrations"
  | "platform";
type PageMode = "root" | "auth" | "dashboard";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1";
/** Dark CRM surfaces — high contrast black / zinc / yellow */
const INPUT_CLASS =
  "w-full rounded-xl border border-zinc-600 bg-black/50 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 outline-none transition focus:border-crm-accent focus:ring-2 focus:ring-crm-accent/25";
const CARD_CLASS =
  "rounded-2xl border border-crm-border bg-crm-elevated/95 p-4 shadow-lg shadow-black/40 backdrop-blur-sm";
/** Light inputs for auth cards (dark text on white) */
const INPUT_AUTH_LIGHT =
  "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-crm-accent-dim focus:ring-2 focus:ring-yellow-200";

/** If there is no +, a 10-digit Indian mobile (6–9…) or 12-digit 91… is treated as +91 (matches backend). */
function normalizePhoneInputIndiaDefault(raw: string): string {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return "";
  if (t.startsWith("+")) return t;
  let digits = t.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]\d{9}$/.test(digits.slice(2))) return `+${digits}`;
  if (digits) return `+${digits}`;
  return t;
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

/** Compact table / toolbar actions */
const BTN_ROW =
  "inline-flex min-h-[2rem] min-w-[4.5rem] items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crm-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-crm-void disabled:pointer-events-none disabled:opacity-55";
const BTN_PRIMARY =
  "inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl bg-crm-accent px-4 py-2 text-sm font-bold text-black shadow-md shadow-crm-accent/20 transition hover:bg-crm-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crm-accent focus-visible:ring-offset-2 focus-visible:ring-offset-crm-void disabled:pointer-events-none disabled:opacity-55";
const BTN_PRIMARY_BLUE =
  "inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl bg-crm-accent px-4 py-2 text-sm font-bold text-black shadow-md shadow-crm-accent/20 transition hover:bg-crm-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crm-accent focus-visible:ring-offset-2 focus-visible:ring-offset-crm-void disabled:pointer-events-none disabled:opacity-55";
const BTN_SUCCESS =
  "inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl bg-lime-500 px-4 py-2 text-sm font-bold text-black shadow-md transition hover:bg-lime-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-crm-void disabled:pointer-events-none disabled:opacity-55";
const BTN_SECONDARY =
  "inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl border border-zinc-500 bg-zinc-800/80 px-4 py-2 text-sm font-semibold text-zinc-100 shadow-sm transition hover:border-crm-accent/50 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crm-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-crm-void disabled:pointer-events-none disabled:opacity-55";

/**
 * Display name + URL slug derived from email.
 * Slug includes sanitized local + domain so two different emails rarely collide (e.g. a@acme.com vs a@other.com).
 * Uniqueness is still enforced on the server — rare slug clashes can be fixed via "Customize".
 */
function deriveWorkspaceFromEmail(emailRaw: string): { name: string; slug: string } {
  const email = emailRaw.trim().toLowerCase();
  const at = email.indexOf("@");
  if (at < 1 || at === email.length - 1) {
    return { name: "My workspace", slug: "workspace" };
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const domainSlug = domain
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/\./g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const localSlug = local
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const slug = [localSlug || "user", domainSlug || "workspace"].join("-").slice(0, 120);

  const words = local.replace(/[._-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const name =
    words.length > 0
      ? `${words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")} workspace`.slice(0, 120)
      : "My workspace";

  return { name, slug };
}

/** Workspace ID from company / workspace name (e.g. "Acme Sales" → "acme-sales"). */
function slugifyWorkspaceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

/** WABA costs in INR; Meta bucket timestamps interpreted in IST for display (avoids UTC midnight looking “wrong”). */
const META_BILLING_LOCALE = "en-IN";
const META_BILLING_CURRENCY = "INR";
const META_ANALYTICS_TIMEZONE = "Asia/Kolkata";

const metaInrFormatter = new Intl.NumberFormat(META_BILLING_LOCALE, {
  style: "currency",
  currency: META_BILLING_CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function formatMetaInr(amount: number): string {
  return metaInrFormatter.format(amount);
}

function formatMetaPricingBucketStart(unixSeconds: number, granularity: string): string {
  const date = new Date(unixSeconds * 1000);
  if (granularity === "DAILY" || granularity === "MONTHLY") {
    return date.toLocaleDateString(META_BILLING_LOCALE, {
      timeZone: META_ANALYTICS_TIMEZONE,
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return date.toLocaleString(META_BILLING_LOCALE, {
    timeZone: META_ANALYTICS_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatMetaRangeDateFromUnix(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(META_BILLING_LOCALE, {
    timeZone: META_ANALYTICS_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatMetaFetchedAtIso(iso: string): string {
  return new Date(iso).toLocaleString(META_BILLING_LOCALE, {
    timeZone: META_ANALYTICS_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} shrink-0 animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function isMetaAccessTokenError(text: string): boolean {
  if (/session has expired/i.test(text) || /error validating access token/i.test(text)) return true;
  if (/['"]code['"]\s*:\s*190\b/.test(text)) return true;
  if (/access token is required/i.test(text) && /['"]code['"]\s*:\s*104\b/.test(text)) return true;
  return false;
}

function decodeJwtExpSeconds(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function shouldAutoLogoutOn401(path: string, hasToken: boolean): boolean {
  if (!hasToken) return false;
  if (path.startsWith("/auth/login") || path.startsWith("/auth/register")) return false;
  if (path.startsWith("/auth/phone/")) return false;
  return true;
}

function formatApiErrorBody(text: string, status: number): string {
  const trimmed = (text || "").trim();
  if (!trimmed) return "Something went wrong. Please try again.";
  if (status === 429) return "Too many requests. Please wait a minute and try again.";
  if (status === 401) return "Session expired. Please log in again.";
  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown };
    if (typeof parsed.detail === "string") {
      const d = parsed.detail;
      if (isMetaAccessTokenError(d)) {
        return "Meta access token expired or invalid. Use a System User token in WhatsApp Settings (not API Setup).";
      }
      if (d.length > 400) return d.slice(0, 400) + "…";
      return d;
    }
    if (Array.isArray(parsed.detail)) {
      const parts = (parsed.detail as { msg?: string }[]).map((item) => item.msg).filter(Boolean);
      if (parts.length) return parts.join("; ");
    }
  } catch {
    /* not JSON */
  }
  if (isMetaAccessTokenError(trimmed)) {
    return "Meta access token expired or invalid. Use a System User token in WhatsApp Settings (not API Setup).";
  }
  if (trimmed.length > 400) return trimmed.slice(0, 400) + "…";
  return trimmed;
}

function getSelectedTemplate(templateKey: string, templateItems: TemplateItem[]): TemplateItem | undefined {
  return templateItems.find((it) => `${it.name}__${it.language}` === templateKey);
}

function smartDefaultForVariable(key: string, contactName: string | null, category?: string | null): string {
  const kl = key.toLowerCase();
  if (!/^\d+$/.test(key) && /name|customer|first|user|recipient/.test(kl)) {
    return (contactName || "").trim();
  }
  if (category?.toUpperCase() === "AUTHENTICATION") {
    return "";
  }
  return "";
}

function initTemplateVarValues(template: TemplateItem | undefined, contactName: string | null): Record<string, string> {
  if (!template?.body_variables?.length) return {};
  const out: Record<string, string> = {};
  for (const key of template.body_variables) {
    out[key] = smartDefaultForVariable(key, contactName, template.category);
  }
  if (
    template.body_variables.length === 1 &&
    !out[template.body_variables[0]] &&
    template.category?.toUpperCase() !== "AUTHENTICATION"
  ) {
    out[template.body_variables[0]] = (contactName || "Customer").trim() || "Customer";
  }
  return out;
}

function validateTemplateVarValues(
  bodyVars: string[],
  varValues: Record<string, string>,
  category?: string | null
): string | null {
  for (const key of bodyVars) {
    if (varValues[key]?.trim()) continue;
    if (category?.toUpperCase() === "AUTHENTICATION" || /^\d+$/.test(key)) {
      return `Enter a value for variable {{${key}}}.`;
    }
  }
  return null;
}

function buildTemplateSendPayload(
  templateKey: string,
  templateItems: TemplateItem[],
  recipientName: string | null,
  varValues?: Record<string, string>
): { template_name: string; language_code: string; body_parameters?: Array<{ type: "text"; text: string; parameter_name?: string }> } | null {
  if (!templateKey) return null;
  const sep = templateKey.indexOf("__");
  const template_name = sep >= 0 ? templateKey.slice(0, sep) : templateKey;
  const language_code = sep >= 0 ? templateKey.slice(sep + 2) : "en_US";
  const selected = getSelectedTemplate(templateKey, templateItems);
  const bodyVars = selected?.body_variables ?? [];
  const fillValue = (recipientName || "Customer").trim() || "Customer";
  const body_parameters =
    bodyVars.length > 0
      ? bodyVars.map((key) => {
          const isPositional = /^\d+$/.test(key);
          const fromUser = varValues?.[key]?.trim();
          const text =
            fromUser ||
            smartDefaultForVariable(key, recipientName, selected?.category) ||
            (selected?.category?.toUpperCase() === "AUTHENTICATION" ? "" : fillValue);
          return isPositional
            ? { type: "text" as const, text }
            : { type: "text" as const, text, parameter_name: key };
        })
      : undefined;
  return { template_name, language_code, body_parameters };
}

function TemplateVariableFields({
  templateKey,
  templateItems,
  values,
  onChange,
  contactName,
  broadcastHint,
}: {
  templateKey: string;
  templateItems: TemplateItem[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  contactName?: string | null;
  broadcastHint?: boolean;
}) {
  const template = getSelectedTemplate(templateKey, templateItems);
  const vars = template?.body_variables ?? [];
  if (!vars.length) return null;
  return (
    <div className="space-y-2 rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">Template variables</p>
      {broadcastHint && (
        <p className="text-[11px] text-zinc-400">
          Name-like variables are filled per contact from CRM. Set shared values here (e.g. promo code). For unique OTPs per
          person, use CSV columns or an API campaign.
        </p>
      )}
      {vars.map((key) => {
        const isPositional = /^\d+$/.test(key);
        const label = isPositional ? `Variable {{${key}}}` : `{{${key}}}`;
        const placeholder =
          template?.category?.toUpperCase() === "AUTHENTICATION" && isPositional
            ? "e.g. 123456"
            : smartDefaultForVariable(key, contactName ?? null, template?.category) || "Enter value";
        return (
          <div key={key}>
            <label className="mb-1 block text-xs font-medium text-zinc-300">{label}</label>
            <input
              className={INPUT_CLASS}
              value={values[key] ?? ""}
              placeholder={placeholder}
              onChange={(e) => onChange(key, e.target.value)}
            />
          </div>
        );
      })}
      <p className="text-[10px] text-zinc-500">
        Language must match Meta exactly ({template?.language || "sync templates"}). Wrong language causes error #132001.
      </p>
    </div>
  );
}

function isApprovedTemplate(item: TemplateItem): boolean {
  return (item.status || "").toUpperCase() === "APPROVED";
}

function buildApiTriggerRequestBody(bodyVars: string[]): Record<string, unknown> {
  const base: Record<string, unknown> = {
    to_phone_e164: "+919876543210",
    name: "Contact name",
  };
  if (bodyVars.length > 0) {
    base.body_parameters = bodyVars.map((key) => ({
      type: "text",
      text: /^\d+$/.test(key) ? `Value for {{${key}}}` : `Sample ${key.replace(/_/g, " ")}`,
    }));
  }
  return base;
}

function buildApiCampaignTriggerSnippet(apiBase: string, campaignId: string, bodyVars: string[]): string {
  const body = buildApiTriggerRequestBody(bodyVars);
  return `POST ${apiBase}/integrations/campaigns/${campaignId}/trigger
Header: X-Integration-Key: wsk.<key-id>.<secret>
Content-Type: application/json

${JSON.stringify(body, null, 2)}`;
}

function buildApiCampaignCurlSnippet(apiBase: string, campaignId: string, bodyVars: string[]): string {
  const body = buildApiTriggerRequestBody(bodyVars);
  return `curl -X POST "${apiBase}/integrations/campaigns/${campaignId}/trigger" \\
  -H "Content-Type: application/json" \\
  -H "X-Integration-Key: wsk.<key-id>.<secret>" \\
  -d '${JSON.stringify(body)}'`;
}

function ApiCampaignTriggerKit({
  campaignId,
  campaignStatus,
  templateName,
  templateLanguage,
  templateItems,
}: {
  campaignId: string;
  campaignStatus?: string;
  templateName: string | null;
  templateLanguage: string | null;
  templateItems: TemplateItem[];
}) {
  const [copied, setCopied] = useState<"http" | "curl" | null>(null);
  const template =
    templateName && templateLanguage
      ? templateItems.find((t) => t.name === templateName && t.language === templateLanguage)
      : undefined;
  const bodyVars = template?.body_variables ?? [];
  const httpSnippet = buildApiCampaignTriggerSnippet(API_BASE, campaignId, bodyVars);
  const curlSnippet = buildApiCampaignCurlSnippet(API_BASE, campaignId, bodyVars);

  async function copy(which: "http" | "curl") {
    await navigator.clipboard.writeText(which === "http" ? httpSnippet : curlSnippet);
    setCopied(which);
    window.setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-indigo-800/40 bg-indigo-950/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-200/90">External CRM trigger (Option A)</p>
      {campaignStatus && campaignStatus !== "live" && (
        <p className="text-xs text-amber-200">
          Set this campaign to <strong className="text-amber-100">live</strong> before your CRM can trigger sends.
        </p>
      )}
      <p className="font-mono text-[10px] text-zinc-400">campaign_id: {campaignId}</p>
      {templateName && (
        <p className="text-xs text-zinc-400">
          Template: <span className="font-medium text-zinc-200">{templateName}</span>
          {templateLanguage ? ` (${templateLanguage})` : ""}
        </p>
      )}
      {bodyVars.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-1 text-[10px] font-medium text-zinc-400">Variable mapping</p>
          <table className="min-w-full text-left text-[11px] text-zinc-300">
            <thead>
              <tr className="text-zinc-500">
                <th className="py-1 pr-3">Template slot</th>
                <th className="py-1 pr-3">API field</th>
                <th className="py-1">Example</th>
              </tr>
            </thead>
            <tbody>
              {bodyVars.map((key, i) => (
                <tr key={`${key}-${i}`} className="border-t border-zinc-700/80">
                  <td className="py-1 pr-3 font-mono">{/^\d+$/.test(key) ? `{{${key}}}` : key}</td>
                  <td className="py-1 pr-3 font-mono">body_parameters[{i}]</td>
                  <td className="py-1 text-zinc-400">
                    {/^\d+$/.test(key) ? `Value for {{${key}}}` : `Sample ${key.replace(/_/g, " ")}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-zinc-500">
            Your CRM sends one object per variable, in the same order as the template body.
          </p>
        </div>
      )}
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-[10px] text-zinc-300">{httpSnippet}</pre>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-indigo-500 px-2 py-1 text-xs text-indigo-200 hover:bg-indigo-950/50"
          onClick={() => void copy("http")}
        >
          {copied === "http" ? "Copied!" : "Copy HTTP"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-zinc-500 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800/50"
          onClick={() => void copy("curl")}
        >
          {copied === "curl" ? "Copied!" : "Copy cURL"}
        </button>
      </div>
    </div>
  );
}

function formatWindowRemaining(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

function windowBadgeLabel(window: MessagingWindow | undefined): string {
  if (!window) return "Unknown";
  return window.is_open ? "Reply open" : "Template only";
}

function windowBadgeClass(window: MessagingWindow | undefined): string {
  if (!window) return "rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400";
  return window.is_open
    ? "rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-300"
    : "rounded-full bg-amber-900/50 px-2 py-0.5 text-xs text-amber-200";
}

function platformWhatsAppNumberLine(
  health: PlatformMetaHealth | null | undefined,
  whatsapp?: { display_phone_number?: string | null; phone_number_id?: string | null; verified_name?: string | null }
): { primary: string | null; secondary: string | null } {
  const display = whatsapp?.display_phone_number ?? health?.display_phone_number ?? null;
  const phoneId = whatsapp?.phone_number_id ?? health?.phone_number_id ?? null;
  const verified = whatsapp?.verified_name ?? health?.verified_name ?? null;
  if (display) {
    return {
      primary: display,
      secondary: verified ? `${verified}${phoneId ? ` · ID ${phoneId}` : ""}` : phoneId ? `ID ${phoneId}` : null
    };
  }
  if (phoneId) {
    return { primary: null, secondary: `Phone number ID: ${phoneId}` };
  }
  return { primary: null, secondary: null };
}

type CampaignLaunchType = "contacts" | "csv" | "api";

function campaignTypeLabel(campaignType: string): string {
  if (campaignType === "csv") return "CSV broadcast";
  if (campaignType === "api") return "API campaign";
  return "Contact broadcast";
}

/** India reference rates per delivered template (Meta per-message billing). */
const META_INR_PER_MESSAGE: Record<string, number> = {
  MARKETING: 0.8846,
  UTILITY: 0.125,
  AUTHENTICATION: 0.125,
  SERVICE: 0,
};

function normalizeTemplateCategory(category: string | null | undefined): string {
  if (!category) return "UNKNOWN";
  return category.trim().toUpperCase().replace(/-/g, "_");
}

function rateInrPerMessage(category: string | null | undefined): number {
  const key = normalizeTemplateCategory(category);
  if (key in META_INR_PER_MESSAGE) return META_INR_PER_MESSAGE[key];
  if (key.includes("MARKETING")) return META_INR_PER_MESSAGE.MARKETING;
  if (key.includes("UTILITY")) return META_INR_PER_MESSAGE.UTILITY;
  if (key.includes("AUTHENTICATION")) return META_INR_PER_MESSAGE.AUTHENTICATION;
  return META_INR_PER_MESSAGE.MARKETING;
}

function estimateCampaignCostLocal(
  templateCategory: string | null | undefined,
  recipientCount: number
): CampaignCostEstimate {
  const count = Math.max(0, recipientCount);
  const rate = rateInrPerMessage(templateCategory);
  const cat = normalizeTemplateCategory(templateCategory);
  return {
    recipient_count: count,
    billable_messages: count,
    rate_per_message_inr: rate,
    estimated_total_inr: Math.round(count * rate * 100) / 100,
    currency: "INR",
    template_category: cat === "UNKNOWN" ? null : cat,
    pricing_model: "per_message",
    rate_note: `₹${rate.toFixed(4)} per delivered template (India reference)`,
    disclaimer:
      "Estimate only. Actual Meta charges vary by delivery, country, and category. Utility may be free inside 24h window.",
  };
}

function CampaignCostPanel({
  estimate,
  perTrigger,
}: {
  estimate: CampaignCostEstimate | null;
  perTrigger?: boolean;
}) {
  if (!estimate || estimate.recipient_count <= 0) return null;
  return (
    <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/25 p-3 text-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/90">Approx. Meta cost</p>
      <p className="mt-1 text-lg font-semibold text-emerald-100">{formatMetaInr(estimate.estimated_total_inr)}</p>
      <p className="mt-1 text-xs text-zinc-400">
        {perTrigger
          ? `${formatMetaInr(estimate.rate_per_message_inr)} per API trigger`
          : `${estimate.billable_messages} × ${formatMetaInr(estimate.rate_per_message_inr)}`}
        {estimate.template_category ? ` · ${estimate.template_category}` : ""}
      </p>
      <p className="mt-2 text-[10px] text-zinc-500">{estimate.disclaimer}</p>
    </div>
  );
}

async function countCsvDataRows(file: File): Promise<number> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

const INBOX_MEDIA_TYPES = new Set(["image", "document", "sticker", "video", "audio"]);

function inboxMediaPlaceholderOnly(messageType: string, display: string): boolean {
  if (messageType === "image" && display === "[Image]") return true;
  if (messageType === "sticker" && display === "[Sticker]") return true;
  if (messageType === "video" && display === "[Video]") return true;
  if (messageType === "audio" && display === "[Audio]") return true;
  if (messageType === "document" && (display === "[Document]" || display.startsWith("[Document:"))) return true;
  return false;
}

function InboxMessageMedia({
  messageId,
  messageType,
  authToken,
  direction
}: {
  messageId: string;
  messageType: string;
  authToken: string;
  direction: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authToken) {
      setLoading(false);
      setError("Session required.");
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setBlobUrl(null);
      try {
        const res = await fetch(`${API_BASE}/whatsapp/messages/${messageId}/media`, {
          headers: { Authorization: `Bearer ${authToken}` }
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(formatApiErrorBody(text, res.status));
        }
        const blob = await res.blob();
        const u = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        urlRef.current = u;
        setBlobUrl(u);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [messageId, messageType, authToken]);

  const muted = direction === "outbound" ? "text-black/70" : "text-zinc-500";
  if (loading) {
    return (
      <p className={`flex items-center gap-1.5 text-xs ${muted}`}>
        <Spinner className="h-3.5 w-3.5" /> Loading…
      </p>
    );
  }
  if (error) {
    const hint =
      /expired|invalid|token|no longer available/i.test(error)
        ? "Update your System User token in WhatsApp Settings, or ask the contact to resend the file."
        : "Check WhatsApp Settings (valid token) or ask the contact to resend.";
    return (
      <div className="mt-1 rounded-lg border border-rose-500/30 bg-rose-950/40 px-2.5 py-2 text-xs text-rose-200/90">
        <p className="font-medium text-rose-100">Media unavailable</p>
        <p className="mt-0.5 text-[11px] leading-snug">{error}</p>
        <p className="mt-1 text-[10px] text-rose-300/80">{hint}</p>
      </div>
    );
  }
  if (!blobUrl) return null;

  if (messageType === "image" || messageType === "sticker") {
    return <img src={blobUrl} alt="" className="mt-1 max-h-56 max-w-full rounded-lg object-contain" />;
  }
  if (messageType === "video") {
    return <video src={blobUrl} controls className="mt-1 max-h-64 max-w-full rounded-lg" />;
  }
  if (messageType === "audio") {
    return <audio src={blobUrl} controls className="mt-2 w-full max-w-[min(100%,20rem)]" />;
  }
  if (messageType === "document") {
    return (
      <a
        href={blobUrl}
        download
        target="_blank"
        rel="noreferrer"
        className={`mt-1 inline-flex text-sm font-medium underline ${direction === "outbound" ? "text-black" : "text-crm-accent"}`}
      >
        Open document
      </a>
    );
  }
  return null;
}

/** Tailwind classes for Meta template review status badges (approved / pending / not approved). */
function templateStatusBadgeClass(status: string | null | undefined): string {
  const s = (status || "").trim().toUpperCase();
  const base = "mt-2 inline-block rounded-full px-2 py-1 text-[10px] font-semibold ring-1";
  if (s === "APPROVED") {
    return `${base} bg-emerald-100 text-emerald-800 ring-emerald-200/90`;
  }
  const pendingLike =
    !s ||
    s === "PENDING" ||
    s.includes("PENDING") ||
    s === "SUBMITTED" ||
    s.includes("REVIEW") ||
    s === "DRAFT";
  if (pendingLike) {
    return `${base} bg-zinc-700 text-zinc-200 ring-zinc-500/90`;
  }
  return `${base} bg-rose-100 text-rose-800 ring-rose-200/90`;
}

/** Unique {{n}} placeholders in order of first appearance (matches Meta positional ordering). */
function positionalPlaceholderOrder(body: string): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const n = parseInt(m[1], 10);
    if (!seen.has(n)) {
      seen.add(n);
      order.push(n);
    }
  }
  return order;
}

/** Common Meta template language codes; override with the custom field when needed. */
const WHATSAPP_TEMPLATE_LANGUAGES: { code: string; label: string }[] = [
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "hi_IN", label: "Hindi" },
  { code: "gu_IN", label: "Gujarati" },
  { code: "mr_IN", label: "Marathi" },
  { code: "ta_IN", label: "Tamil" },
  { code: "te_IN", label: "Telugu" },
  { code: "bn_IN", label: "Bengali" },
  { code: "kn_IN", label: "Kannada" },
  { code: "ml_IN", label: "Malayalam" },
  { code: "pa_IN", label: "Punjabi" },
  { code: "es_ES", label: "Spanish (Spain)" },
  { code: "es_MX", label: "Spanish (Mexico)" },
  { code: "pt_BR", label: "Portuguese (Brazil)" },
  { code: "fr_FR", label: "French" },
  { code: "de_DE", label: "German" },
  { code: "it_IT", label: "Italian" },
  { code: "ar_AR", label: "Arabic" },
  { code: "id_ID", label: "Indonesian" },
  { code: "ja_JP", label: "Japanese" },
  { code: "ko_KR", label: "Korean" },
  { code: "th_TH", label: "Thai" },
  { code: "vi_VN", label: "Vietnamese" },
  { code: "fil_PH", label: "Filipino" },
  { code: "ms_MY", label: "Malay" },
  { code: "zh_CN", label: "Chinese (CN)" },
  { code: "zh_HK", label: "Chinese (HK)" },
  { code: "zh_TW", label: "Chinese (TW)" }
];

type InboxBubbleVariant = "inbound" | "outbound";

/** WhatsApp-style: *bold*, _italic_, ~strikethrough~, ```monospace```, line breaks preserved. */
function formatWhatsAppLine(line: string, lineKey: number, variant: InboxBubbleVariant): ReactNode {
  const codeClass =
    variant === "outbound"
      ? "rounded bg-black/10 px-1 py-0.5 font-mono text-[0.92em] text-zinc-900"
      : "rounded bg-zinc-700/90 px-1 py-0.5 font-mono text-[0.92em] text-zinc-100";

  const chunks: ReactNode[] = [];
  let i = 0;
  let plainStart = 0;

  const flushPlain = (end: number) => {
    if (end > plainStart) {
      chunks.push(line.slice(plainStart, end));
      plainStart = end;
    }
  };

  while (i < line.length) {
    const rest = line.slice(i);
    const mono = rest.match(/^```([^`]+)```/);
    if (mono) {
      flushPlain(i);
      chunks.push(
        <code key={`${lineKey}-m-${i}`} className={codeClass}>
          {mono[1]}
        </code>
      );
      i += mono[0].length;
      plainStart = i;
      continue;
    }
    const dBold = rest.match(/^\*\*([^*]+)\*\*/);
    if (dBold) {
      flushPlain(i);
      chunks.push(
        <strong key={`${lineKey}-db-${i}`} className="font-semibold">
          {dBold[1]}
        </strong>
      );
      i += dBold[0].length;
      plainStart = i;
      continue;
    }
    const bold = rest.match(/^\*([^*\n]+)\*/);
    if (bold) {
      flushPlain(i);
      chunks.push(
        <strong key={`${lineKey}-b-${i}`} className="font-semibold">
          {bold[1]}
        </strong>
      );
      i += bold[0].length;
      plainStart = i;
      continue;
    }
    const italic = rest.match(/^_(?!_)([^_\n]+)_/);
    if (italic) {
      flushPlain(i);
      chunks.push(
        <em key={`${lineKey}-i-${i}`} className="italic">
          {italic[1]}
        </em>
      );
      i += italic[0].length;
      plainStart = i;
      continue;
    }
    const strike = rest.match(/^~([^~\n]+)~/);
    if (strike) {
      flushPlain(i);
      chunks.push(
        <del key={`${lineKey}-s-${i}`} className={variant === "outbound" ? "opacity-90" : "opacity-80"}>
          {strike[1]}
        </del>
      );
      i += strike[0].length;
      plainStart = i;
      continue;
    }
    i += 1;
  }
  flushPlain(i);
  return <>{chunks}</>;
}

function formatWhatsAppRichText(text: string, variant: InboxBubbleVariant): ReactNode {
  const trimmed = (text || "").replace(/\r\n/g, "\n");
  if (!trimmed) return null;
  const lines = trimmed.split("\n");
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed">
      {lines.map((line, idx) => (
        <Fragment key={idx}>
          {idx > 0 ? <br /> : null}
          {formatWhatsAppLine(line, idx, variant)}
        </Fragment>
      ))}
    </div>
  );
}

type InlineFeedbackKind = "success" | "error";
type InlineFeedback = { text: string; variant: InlineFeedbackKind };

/** Where to show short-lived inline messages (below the relevant control). */
type FeedbackSlot =
  | "authLogin"
  | "authRegister"
  | "authPhoneLogin"
  | "phoneBindSettings"
  | "sectionRefresh"
  | "tagCreate"
  | "tagRefresh"
  | "contactCreate"
  | "contactImport"
  | "contactList"
  | "contactQuickSend"
  | "contactEdit"
  | "campaignCreate"
  | "campaignActions"
  | "templatesToolbar"
  | "templateCreate"
  | "integrationPanel"
  | "platformPanel"
  | "platformMonitor"
  | "waConnectionForm"
  | "waTemplateTest"
  | "inboxReply"
  | "inboxTemplate"
  | "inboxList"
  | "inboxThread"
  | "metaPricing"
  | "tagPerf";

function InlineFeedbackText({
  feedback,
  className = "",
  surface = "dark"
}: {
  feedback: InlineFeedback | undefined;
  className?: string;
  surface?: "light" | "dark";
}) {
  if (!feedback) return null;
  const tone =
    surface === "light"
      ? feedback.variant === "success"
        ? "text-emerald-900 border-emerald-200 bg-emerald-50"
        : "text-red-900 border-red-200 bg-red-50"
      : feedback.variant === "success"
        ? "text-lime-400 border-lime-500/40 bg-lime-500/10"
        : "text-red-300 border-red-500/40 bg-red-500/10";
  return (
    <p
      role="status"
      className={`mt-2 rounded-lg border px-3 py-2 text-sm font-medium ${tone} ${className}`.trim()}
    >
      {feedback.text}
    </p>
  );
}

function toggleTagSelection(selectedIds: string[], tagId: string, allowMultiple: boolean): string[] {
  if (!allowMultiple) {
    return selectedIds.includes(tagId) ? [] : [tagId];
  }
  return selectedIds.includes(tagId) ? selectedIds.filter((id) => id !== tagId) : [...selectedIds, tagId];
}

function TagChipPicker({
  tags,
  selectedIds,
  onChange,
  counts,
  allowMultiple = true,
  emptyLabel = "No tags yet. Create one below.",
  showAllOption = false,
  allSelected = false,
  onSelectAll,
}: {
  tags: Tag[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  counts?: Record<string, number>;
  allowMultiple?: boolean;
  emptyLabel?: string;
  showAllOption?: boolean;
  allSelected?: boolean;
  onSelectAll?: () => void;
}) {
  if (tags.length === 0 && !showAllOption) {
    return <p className="text-sm text-zinc-500">{emptyLabel}</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {showAllOption && onSelectAll && (
        <button
          type="button"
          onClick={onSelectAll}
          className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
            allSelected
              ? "border-crm-accent bg-crm-accent text-black shadow-sm shadow-crm-accent/30"
              : "border-zinc-600 bg-zinc-900/80 text-zinc-300 hover:border-zinc-400 hover:text-white"
          }`}
        >
          All contacts
          {counts && counts.__all != null ? <span className="ml-1 opacity-80">({counts.__all})</span> : null}
        </button>
      )}
      {tags.map((tag) => {
        const selected = selectedIds.includes(tag.id);
        const count = counts?.[tag.id];
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => onChange(toggleTagSelection(selectedIds, tag.id, allowMultiple))}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              selected
                ? "border-crm-accent bg-crm-accent text-black shadow-sm shadow-crm-accent/30"
                : "border-zinc-600 bg-zinc-900/80 text-zinc-300 hover:border-zinc-400 hover:text-white"
            }`}
          >
            {tag.name}
            {count != null ? <span className={`ml-1 ${selected ? "text-black/70" : "text-zinc-500"}`}>({count})</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function ContactPreviewPanel({
  title,
  contacts,
  loading,
  emptyHint,
}: {
  title: string;
  contacts: Contact[];
  loading?: boolean;
  emptyHint: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-600 bg-black/30">
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2.5">
        <p className="text-sm font-medium text-zinc-100">{title}</p>
        <span className="rounded-full bg-crm-accent/20 px-2.5 py-0.5 text-xs font-semibold text-crm-accent">
          {loading ? "…" : contacts.length} total
        </span>
      </div>
      <div className="max-h-52 overflow-y-auto divide-y divide-zinc-800">
        {loading ? (
          <p className="px-3 py-6 text-center text-sm text-zinc-500">Loading contacts…</p>
        ) : contacts.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-zinc-500">{emptyHint}</p>
        ) : (
          contacts.map((contact) => (
            <div key={contact.id} className="px-3 py-2.5 text-sm">
              <p className="font-medium text-zinc-100">{contact.name || "Unnamed"}</p>
              <p className="text-xs text-zinc-500">{contact.phone_e164}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function AppClient({
  mode = "dashboard",
  initialSection = "contacts",
  platformMonitorTenantId: initialPlatformMonitorTenantId = null
}: {
  mode?: PageMode;
  initialSection?: string;
  platformMonitorTenantId?: string | null;
}) {
  const router = useRouter();
  const normalizedInitialSection: DashboardSection = (
    [
      "contacts",
      "campaigns",
      "templates",
      "inbox",
      "settings",
      "analytics",
      "automations",
      "integrations",
      "platform"
    ].includes(initialSection)
      ? initialSection
      : "contacts"
  ) as DashboardSection;
  const [token, setToken] = useState(() => (typeof window !== "undefined" ? window.localStorage.getItem("auth_token") || "" : ""));
  const sessionExpiredHandledRef = useRef(false);
  const [email, setEmail] = useState(() => (typeof window !== "undefined" ? window.localStorage.getItem("auth_email") || "" : ""));
  const [password, setPassword] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [profilePhoneE164, setProfilePhoneE164] = useState<string | null | undefined>(undefined);
  const [bindPhone, setBindPhone] = useState("");
  const [bindOtp, setBindOtp] = useState("");
  const [bindOtpIssuedForE164, setBindOtpIssuedForE164] = useState<string | null>(null);
  const [loginSubtab, setLoginSubtab] = useState<"email" | "phone">("email");
  const [loginPhone, setLoginPhone] = useState("");
  const [loginOtp, setLoginOtp] = useState("");
  const [otpIssuedForE164, setOtpIssuedForE164] = useState<string | null>(null);
  const [authPanel, setAuthPanel] = useState<"login" | "register">("login");
  const [registerCustomizeWorkspace, setRegisterCustomizeWorkspace] = useState(false);
  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [tagName, setTagName] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [contactImportCsvFile, setContactImportCsvFile] = useState<File | null>(null);
  const [contactImportTagIds, setContactImportTagIds] = useState<string[]>([]);
  const [contactImportRowCount, setContactImportRowCount] = useState(0);
  const [importingContacts, setImportingContacts] = useState(false);
  const [contactDirectory, setContactDirectory] = useState<Contact[]>([]);
  const [activeListTagId, setActiveListTagId] = useState<string | null>(null);
  const [listFilterLoading, setListFilterLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [attributesInput, setAttributesInput] = useState("");
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAttributesInput, setEditAttributesInput] = useState("");
  const [editTagIds, setEditTagIds] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignName, setCampaignName] = useState("");
  const [campaignLaunchType, setCampaignLaunchType] = useState<CampaignLaunchType>("contacts");
  const [campaignContactIds, setCampaignContactIds] = useState<string[]>([]);
  const [campaignTargetMode, setCampaignTargetMode] = useState<"manual" | "tags">("tags");
  const [campaignTagIds, setCampaignTagIds] = useState<string[]>([]);
  const [campaignTagRecipientCount, setCampaignTagRecipientCount] = useState(0);
  const [campaignTagPreviewContacts, setCampaignTagPreviewContacts] = useState<Contact[]>([]);
  const [campaignTagPreviewLoading, setCampaignTagPreviewLoading] = useState(false);
  const [campaignCsvFile, setCampaignCsvFile] = useState<File | null>(null);
  const [csvRowCount, setCsvRowCount] = useState(0);
  const [csvDraftCampaignId, setCsvDraftCampaignId] = useState<string | null>(null);
  const [selectedApiCampaignId, setSelectedApiCampaignId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardSection>(normalizedInitialSection);
  const [waPhoneNumberId, setWaPhoneNumberId] = useState("");
  const [waAccessToken, setWaAccessToken] = useState("");
  const [waVerifyToken, setWaVerifyToken] = useState("");
  const [waWabaId, setWaWabaId] = useState("");
  const [waAppSecret, setWaAppSecret] = useState("");
  const [waLabel, setWaLabel] = useState("Primary");
  const [waIsDefault, setWaIsDefault] = useState(true);
  const [waIsActive, setWaIsActive] = useState(true);
  const [waConnectionId, setWaConnectionId] = useState<string>("");
  const [waConnections, setWaConnections] = useState<
    Array<{
      id: string;
      label: string;
      phone_number_id: string;
      waba_id: string | null;
      verify_token_configured: boolean;
      access_token_preview: string;
      app_secret_configured: boolean;
      is_default: boolean;
      is_active: boolean;
    }>
  >([]);
  const wabaConnections = useMemo(() => waConnections.filter((c) => Boolean(c.waba_id)), [waConnections]);
  const [waAccessTokenPreview, setWaAccessTokenPreview] = useState("");
  const [waAppSecretConfigured, setWaAppSecretConfigured] = useState(false);
  const [waVerifyTokenConfigured, setWaVerifyTokenConfigured] = useState(false);
  const [waTemplateName, setWaTemplateName] = useState("");
  const [waTemplateLanguage, setWaTemplateLanguage] = useState("en_US");
  const [waTestToPhone, setWaTestToPhone] = useState("");
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([]);
  const approvedTemplates = useMemo(() => templateItems.filter(isApprovedTemplate), [templateItems]);
  const apiCampaigns = useMemo(
    () => campaigns.filter((c) => (c.campaign_type || "contacts") === "api"),
    [campaigns]
  );
  const liveApiCampaigns = useMemo(() => apiCampaigns.filter((c) => c.status === "live"), [apiCampaigns]);

  const launchRecipientCount = useMemo(() => {
    if (campaignLaunchType === "contacts") {
      if (campaignTargetMode === "tags") return campaignTagRecipientCount;
      return campaignContactIds.length;
    }
    if (campaignLaunchType === "csv") return csvRowCount;
    return 1;
  }, [campaignLaunchType, campaignTargetMode, campaignContactIds.length, campaignTagRecipientCount, csvRowCount]);

  const launchCostEstimate = useMemo(() => {
    const sel = approvedTemplates.find((t) => t.name === waTemplateName && t.language === waTemplateLanguage);
    if (!sel || launchRecipientCount <= 0) return null;
    return estimateCampaignCostLocal(sel.category, launchRecipientCount);
  }, [approvedTemplates, waTemplateName, waTemplateLanguage, launchRecipientCount]);

  const allCampaignContactsSelected = contacts.length > 0 && campaignContactIds.length === contacts.length;

  const tagContactCounts = useMemo(() => {
    const counts: Record<string, number> = { __all: contactDirectory.length };
    for (const tag of tags) counts[tag.id] = 0;
    for (const contact of contactDirectory) {
      for (const tag of contact.tags) {
        counts[tag.id] = (counts[tag.id] ?? 0) + 1;
      }
    }
    return counts;
  }, [tags, contactDirectory]);

  const activeListTagName = useMemo(
    () => (activeListTagId ? tags.find((tag) => tag.id === activeListTagId)?.name ?? null : null),
    [activeListTagId, tags]
  );

  function toggleCampaignContact(contactId: string) {
    setCampaignContactIds((prev) =>
      prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId]
    );
  }

  function toggleAllCampaignContacts() {
    setCampaignContactIds(allCampaignContactsSelected ? [] : contacts.map((c) => c.id));
  }

  useEffect(() => {
    if (!contactImportCsvFile) {
      setContactImportRowCount(0);
      return;
    }
    let cancelled = false;
    void countCsvDataRows(contactImportCsvFile).then((n) => {
      if (!cancelled) setContactImportRowCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [contactImportCsvFile]);

  useEffect(() => {
    if (!campaignCsvFile) {
      setCsvRowCount(0);
      return;
    }
    let cancelled = false;
    void countCsvDataRows(campaignCsvFile).then((n) => {
      if (!cancelled) setCsvRowCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [campaignCsvFile]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationItem | null>(null);
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [inboxLastSyncedAt, setInboxLastSyncedAt] = useState<string>("");
  const [inboxFilterTagId, setInboxFilterTagId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const inboxTagCounts = useMemo(() => {
    const counts: Record<string, number> = { __all: conversations.length };
    for (const tag of tags) counts[tag.id] = 0;
    for (const conversation of conversations) {
      for (const tag of conversation.tags ?? []) {
        counts[tag.id] = (counts[tag.id] ?? 0) + 1;
      }
    }
    return counts;
  }, [conversations, tags]);

  const filteredInboxConversations = useMemo(() => {
    if (!inboxFilterTagId) return conversations;
    return conversations.filter((conversation) => (conversation.tags ?? []).some((tag) => tag.id === inboxFilterTagId));
  }, [conversations, inboxFilterTagId]);

  const inboxFilterTagName = useMemo(
    () => (inboxFilterTagId ? tags.find((tag) => tag.id === inboxFilterTagId)?.name ?? null : null),
    [inboxFilterTagId, tags]
  );

  const [hydrated, setHydrated] = useState(false);
  const [connectionHealth, setConnectionHealth] = useState<{
    overall: string;
    hints: string[];
    token_valid: boolean;
    token_alert?: string | null;
    token_alert_message?: string | null;
    token_error?: string | null;
    waba_configured: boolean;
    webhook_ready: boolean;
    connection_configured: boolean;
  } | null>(null);
  const [quickSendContact, setQuickSendContact] = useState<Contact | null>(null);
  const [quickTemplateKey, setQuickTemplateKey] = useState("");
  const [inlineFeedback, setInlineFeedback] = useState<Partial<Record<FeedbackSlot, InlineFeedback>>>({});
  const feedbackTimersRef = useRef<Partial<Record<FeedbackSlot, number>>>({});
  const [sendingQuickTemplate, setSendingQuickTemplate] = useState(false);
  const [inboxTemplateKey, setInboxTemplateKey] = useState("");
  const [inboxTemplateVars, setInboxTemplateVars] = useState<Record<string, string>>({});
  const [quickTemplateVars, setQuickTemplateVars] = useState<Record<string, string>>({});
  const [campaignTemplateVars, setCampaignTemplateVars] = useState<Record<string, string>>({});
  const [sendingInboxTemplate, setSendingInboxTemplate] = useState(false);
  const [sendingTemplateTest, setSendingTemplateTest] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyAttachment, setReplyAttachment] = useState<File | null>(null);
  const replyFileInputRef = useRef<HTMLInputElement | null>(null);
  const replyImagePreviewUrl = useMemo(() => {
    if (!replyAttachment?.type.startsWith("image/")) return null;
    return URL.createObjectURL(replyAttachment);
  }, [replyAttachment]);
  useEffect(() => {
    return () => {
      if (replyImagePreviewUrl) URL.revokeObjectURL(replyImagePreviewUrl);
    };
  }, [replyImagePreviewUrl]);
  const [savingWaConnection, setSavingWaConnection] = useState(false);
  const [creatingContact, setCreatingContact] = useState(false);
  const [createTplName, setCreateTplName] = useState("");
  const [createTplLanguageSelect, setCreateTplLanguageSelect] = useState("en_US");
  const [createTplLanguageCustom, setCreateTplLanguageCustom] = useState("");
  const [createTplCategory, setCreateTplCategory] = useState<"UTILITY" | "MARKETING" | "AUTHENTICATION">("UTILITY");
  const [createTplBody, setCreateTplBody] = useState("");
  const [createTplHeader, setCreateTplHeader] = useState("");
  const [createTplFooter, setCreateTplFooter] = useState("");
  const [createTplVarRows, setCreateTplVarRows] = useState<Array<{ paramName: string; example: string }>>([]);
  const [createTplAllowCat, setCreateTplAllowCat] = useState(true);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const createTplPhOrder = useMemo(() => positionalPlaceholderOrder(createTplBody), [createTplBody]);
  const [statsSnapshotLoaded, setStatsSnapshotLoaded] = useState(false);
  const [statsSnapshotRefreshing, setStatsSnapshotRefreshing] = useState(false);
  const [statsUpdatedAt, setStatsUpdatedAt] = useState<Date | null>(null);
  const [integrationKeys, setIntegrationKeys] = useState<
    Array<{ id: string; label: string | null; is_active: boolean; created_at: string }>
  >([]);
  const [integrationKeysLoading, setIntegrationKeysLoading] = useState(false);
  const [newIntegrationLabel, setNewIntegrationLabel] = useState("");
  const [revealedIntegrationKey, setRevealedIntegrationKey] = useState<string | null>(null);
  const [creatingIntegrationKey, setCreatingIntegrationKey] = useState(false);
  const [externalWebhookStatus, setExternalWebhookStatus] = useState<{
    configured: boolean;
    url_host: string;
    signing_enabled: boolean;
  } | null>(null);
  const [testingExternalWebhook, setTestingExternalWebhook] = useState(false);
  const [metaPricingLoading, setMetaPricingLoading] = useState(false);
  const [metaPricingData, setMetaPricingData] = useState<MetaPricingResponse | null>(null);
  const [metaPricingGranularity, setMetaPricingGranularity] = useState<"DAILY" | "HALF_HOUR" | "MONTHLY">("DAILY");
  const [metaPricingDays, setMetaPricingDays] = useState<7 | 30>(30);
  const [metaPricingCountryFilter, setMetaPricingCountryFilter] = useState("");
  const [tagPerfLoading, setTagPerfLoading] = useState(false);
  const [tagPerfDays, setTagPerfDays] = useState<0 | 7 | 30>(30);
  const [tagPerfData, setTagPerfData] = useState<TagPerformanceResponse | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [tenantSetupStatus, setTenantSetupStatus] = useState<string>("active");
  const [allowOpenRegistration, setAllowOpenRegistration] = useState(true);
  const [platformSummary, setPlatformSummary] = useState<{
    agents_total: number;
    agents_active: number;
    agents_pending_meta: number;
    agents_disabled: number;
    agents_token_attention: number;
    users: number;
    whatsapp_connections: number;
  } | null>(null);
  const [platformTenants, setPlatformTenants] = useState<PlatformTenantRow[]>([]);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [newAgentEmail, setNewAgentEmail] = useState("");
  const [newAgentPassword, setNewAgentPassword] = useState("");
  const [newAgentFullName, setNewAgentFullName] = useState("");
  const [newAgentTenantName, setNewAgentTenantName] = useState("");
  const [newAgentTenantSlug, setNewAgentTenantSlug] = useState("");
  const [newAgentSlugManual, setNewAgentSlugManual] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [agentActionTenantId, setAgentActionTenantId] = useState<string | null>(null);
  const [agentResetPassword, setAgentResetPassword] = useState("");
  const [agentActionLoading, setAgentActionLoading] = useState(false);
  const [platformMonitorTenantId, setPlatformMonitorTenantId] = useState<string | null>(initialPlatformMonitorTenantId);
  const [platformOverview, setPlatformOverview] = useState<PlatformAgentOverview | null>(null);
  const [platformOverviewLoading, setPlatformOverviewLoading] = useState(false);
  const [platformMonitorConversations, setPlatformMonitorConversations] = useState<ConversationItem[]>([]);
  const [platformMonitorConversation, setPlatformMonitorConversation] = useState<ConversationItem | null>(null);
  const [platformMonitorMessages, setPlatformMonitorMessages] = useState<MonitorMessage[]>([]);
  const [platformMonitorMessagesLoading, setPlatformMonitorMessagesLoading] = useState(false);
  const [platformDeleteTarget, setPlatformDeleteTarget] = useState<PlatformTenantRow | null>(null);
  const [platformDeleteConfirmSlug, setPlatformDeleteConfirmSlug] = useState("");
  const [platformDeleting, setPlatformDeleting] = useState(false);

  const agentNeedsSetup = !isSuperAdmin && tenantSetupStatus === "pending_meta";

  const sectionMeta: Record<string, { title: string; subtitle: string }> = {
    contacts: { title: "Contacts CRM", subtitle: "Manage contacts, tags, attributes, and segmentation." },
    campaigns: { title: "Campaigns", subtitle: "Create targeted broadcasts and monitor dispatch readiness." },
    templates: { title: "Template Library", subtitle: "Sync approved Meta templates and prepare send flows." },
    inbox: { title: "Shared Inbox", subtitle: "Track inbound conversations and reply from one place." },
    settings: { title: "WhatsApp Connections", subtitle: "Manage multiple API numbers, keys, and default routing." },
    analytics: { title: "Analytics", subtitle: "Campaign performance and Meta WABA pricing analytics (estimated spend)." },
    automations: { title: "Automations", subtitle: "Rule-based flows and triggers (module expansion coming soon)." },
    integrations: {
      title: "Integrations",
      subtitle: "API keys and endpoints so other systems can send WhatsApp messages on behalf of this workspace."
    },
    platform: {
      title: "Platform Admin",
      subtitle: "All workspaces, users, and Meta WhatsApp connection health (super-admin only)."
    }
  };

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    void apiRequest<{ allow_open_registration: boolean }>("/auth/public-config")
      .then((data) => setAllowOpenRegistration(Boolean(data.allow_open_registration)))
      .catch(() => setAllowOpenRegistration(true));
  }, []);

  useEffect(() => {
    if (!allowOpenRegistration && authPanel === "register") setAuthPanel("login");
  }, [allowOpenRegistration, authPanel]);

  const flash = useCallback((slot: FeedbackSlot, text: string, variant: InlineFeedbackKind) => {
    const prev = feedbackTimersRef.current[slot];
    if (prev) window.clearTimeout(prev);
    setInlineFeedback((f) => ({ ...f, [slot]: { text, variant } }));
    const ms = variant === "error" ? 10000 : 5000;
    feedbackTimersRef.current[slot] = window.setTimeout(() => {
      setInlineFeedback((f) => {
        const next = { ...f };
        delete next[slot];
        return next;
      });
      delete feedbackTimersRef.current[slot];
    }, ms);
  }, []);

  useEffect(() => {
    if (token) {
      window.localStorage.setItem("auth_token", token);
    } else {
      window.localStorage.removeItem("auth_token");
    }
  }, [token]);

  const handleSessionExpired = useCallback(
    (message = "Your session has expired. Please log in again.") => {
      if (sessionExpiredHandledRef.current) return;
      sessionExpiredHandledRef.current = true;
      setToken("");
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("auth_session_message", message);
      }
      router.push("/login");
    },
    [router]
  );

  useEffect(() => {
    sessionExpiredHandledRef.current = false;
    if (!token) return;
    const exp = decodeJwtExpSeconds(token);
    if (!exp) return;
    const msUntilExp = exp * 1000 - Date.now();
    if (msUntilExp <= 0) {
      handleSessionExpired();
      return;
    }
    const timer = window.setTimeout(() => handleSessionExpired(), msUntilExp);
    return () => window.clearTimeout(timer);
  }, [token, handleSessionExpired]);

  useEffect(() => {
    if (token || mode !== "auth") return;
    const message = typeof window !== "undefined" ? window.sessionStorage.getItem("auth_session_message") : null;
    if (!message) return;
    window.sessionStorage.removeItem("auth_session_message");
    flash("authLogin", message, "error");
  }, [token, mode, flash]);

  useEffect(() => {
    if (email) {
      window.localStorage.setItem("auth_email", email);
    }
  }, [email]);

  useEffect(() => {
    if (!otpIssuedForE164) return;
    const e164 = normalizePhoneInputIndiaDefault(loginPhone);
    if (e164 !== otpIssuedForE164) {
      setOtpIssuedForE164(null);
      setLoginOtp("");
    }
  }, [loginPhone, otpIssuedForE164]);

  useEffect(() => {
    if (!bindOtpIssuedForE164) return;
    const e164 = normalizePhoneInputIndiaDefault(bindPhone);
    if (e164 !== bindOtpIssuedForE164) {
      setBindOtpIssuedForE164(null);
      setBindOtp("");
    }
  }, [bindPhone, bindOtpIssuedForE164]);

  /** Auto workspace name + slug from email unless user opened "Customize". */
  useEffect(() => {
    if (authPanel !== "register" || registerCustomizeWorkspace) return;
    const { name, slug } = deriveWorkspaceFromEmail(email);
    setTenantName(name);
    setTenantSlug(slug);
  }, [email, authPanel, registerCustomizeWorkspace]);

  useEffect(() => {
    setActiveTab(normalizedInitialSection);
  }, [normalizedInitialSection]);

  useEffect(() => {
    if (!hydrated) return;
    if (mode === "root") {
      router.replace(token ? `/dashboard/${activeTab}` : "/login");
      return;
    }
    if (mode === "dashboard" && !token) {
      router.replace("/login");
    }
  }, [mode, token, activeTab, router, hydrated]);

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : ""
    }),
    [token]
  );

  function applyMeProfile(data: MeProfile) {
    setIsSuperAdmin(Boolean(data.is_super_admin));
    setTenantSetupStatus(data.memberships?.[0]?.setup_status ?? "active");
    if (typeof data.allow_open_registration === "boolean") {
      setAllowOpenRegistration(data.allow_open_registration);
    }
  }

  useEffect(() => {
    if (!token) {
      setIsSuperAdmin(false);
      setTenantSetupStatus("active");
      return;
    }
    let cancelled = false;
    void apiRequest<MeProfile>("/auth/me", { headers: authHeaders })
      .then((data) => {
        if (!cancelled) applyMeProfile(data);
      })
      .catch(() => {
        if (!cancelled) {
          setIsSuperAdmin(false);
          setTenantSetupStatus("active");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, authHeaders]);

  useEffect(() => {
    if (!token || mode !== "dashboard") return;
    if (isSuperAdmin && activeTab !== "platform") {
      setActiveTab("platform");
      router.replace("/dashboard/platform");
      return;
    }
    if (agentNeedsSetup && activeTab !== "settings") {
      setActiveTab("settings");
      router.replace("/dashboard/settings");
    }
  }, [token, mode, isSuperAdmin, agentNeedsSetup, activeTab, router]);

  useEffect(() => {
    if (campaignLaunchType !== "contacts" || campaignTargetMode !== "tags" || campaignTagIds.length === 0 || !token) {
      setCampaignTagRecipientCount(0);
      setCampaignTagPreviewContacts([]);
      return;
    }
    let cancelled = false;
    setCampaignTagPreviewLoading(true);
    void apiRequest<Contact[]>("/crm/contacts/filter", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ tag_ids: campaignTagIds })
    })
      .then((data) => {
        if (!cancelled) {
          setCampaignTagRecipientCount(data.length);
          setCampaignTagPreviewContacts(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCampaignTagRecipientCount(0);
          setCampaignTagPreviewContacts([]);
        }
      })
      .finally(() => {
        if (!cancelled) setCampaignTagPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignLaunchType, campaignTargetMode, campaignTagIds, token, authHeaders]);

  useEffect(() => {
    if (!token || activeTab !== "contacts") return;
    let cancelled = false;
    setListFilterLoading(true);
    void (async () => {
      try {
        if (!activeListTagId && !searchQuery.trim()) {
          if (!cancelled) setContacts(contactDirectory);
          return;
        }
        const data = await apiRequest<Contact[]>("/crm/contacts/filter", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            query: searchQuery.trim() || null,
            tag_ids: activeListTagId ? [activeListTagId] : []
          })
        });
        if (!cancelled) setContacts(data);
      } catch {
        if (!cancelled) setContacts([]);
      } finally {
        if (!cancelled) setListFilterLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeListTagId, searchQuery, contactDirectory, token, activeTab, authHeaders]);

  useEffect(() => {
    if (!token || activeTab !== "settings") return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest<{ user: { phone_e164: string | null } }>("/auth/me", {
          headers: authHeaders
        });
        if (!cancelled) setProfilePhoneE164(data.user.phone_e164 ?? null);
      } catch {
        if (!cancelled) setProfilePhoneE164(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, activeTab, authHeaders]);

  const phoneLoginE164Normalized = useMemo(() => {
    const e164 = normalizePhoneInputIndiaDefault(loginPhone);
    return E164_RE.test(e164) ? e164 : "";
  }, [loginPhone]);

  const bindPhoneE164Normalized = useMemo(() => {
    const e164 = normalizePhoneInputIndiaDefault(bindPhone);
    return E164_RE.test(e164) ? e164 : "";
  }, [bindPhone]);

  const campaignStats = useMemo(() => {
    const totals = { running: 0, scheduled: 0, draft: 0, completed: 0, recipients: 0, sent: 0, failed: 0, queued: 0 };
    for (const campaign of campaigns) {
      if (campaign.status === "running") totals.running += 1;
      if (campaign.status === "scheduled") totals.scheduled += 1;
      if (campaign.status === "draft") totals.draft += 1;
      if (campaign.status === "completed") totals.completed += 1;
      totals.recipients += campaign.recipients.length;
      for (const recipient of campaign.recipients) {
        if (recipient.state === "sent") totals.sent += 1;
        else if (recipient.state === "failed") totals.failed += 1;
        else totals.queued += 1;
      }
    }
    return totals;
  }, [campaigns]);

  const approvedTemplateCount = useMemo(
    () => templateItems.filter((t) => (t.status || "").toUpperCase() === "APPROVED").length,
    [templateItems]
  );

  const metaPricingByCategory = useMemo(() => {
    if (!metaPricingData?.data_points.length) return [] as Array<[string, { cost: number; volume: number }]>;
    const map = new Map<string, { cost: number; volume: number }>();
    for (const p of metaPricingData.data_points) {
      const key = p.pricing_category || "—";
      const prev = map.get(key) ?? { cost: 0, volume: 0 };
      prev.cost += p.cost ?? 0;
      prev.volume += p.volume ?? 0;
      map.set(key, prev);
    }
    return [...map.entries()].sort((a, b) => b[1].cost - a[1].cost);
  }, [metaPricingData]);

  async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, options);
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401 && shouldAutoLogoutOn401(path, Boolean(token))) {
        handleSessionExpired();
      }
      throw new Error(formatApiErrorBody(text, response.status));
    }
    return (await response.json()) as T;
  }

  async function apiRequestNoContent(path: string, options: RequestInit = {}): Promise<void> {
    const response = await fetch(`${API_BASE}${path}`, options);
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401 && shouldAutoLogoutOn401(path, Boolean(token))) {
        handleSessionExpired();
      }
      throw new Error(formatApiErrorBody(text, response.status));
    }
  }

  async function handleRegister(event: FormEvent) {
    event.preventDefault();
    const emailTrim = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      flash("authRegister", "Enter a valid email address.", "error");
      return;
    }
    const { name: derivedName, slug: derivedSlug } = deriveWorkspaceFromEmail(emailTrim);
    const name = registerCustomizeWorkspace ? tenantName.trim() : derivedName;
    const slug = (registerCustomizeWorkspace ? tenantSlug : derivedSlug).trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (slug.length < 3) {
      flash("authRegister", "Workspace ID is too short. Use Customize to set a longer slug.", "error");
      return;
    }
    try {
      const registerBody: Record<string, string> = {
        email: emailTrim,
        password,
        tenant_name: name || derivedName,
        tenant_slug: slug
      };
      const phoneTrim = registerPhone.trim();
      if (phoneTrim) {
        const normalized = normalizePhoneInputIndiaDefault(phoneTrim);
        if (!E164_RE.test(normalized)) {
          flash("authRegister", "Enter a valid mobile number (e.g. 9876543210 or +919876543210).", "error");
          return;
        }
        registerBody.phone_e164 = normalized;
      }
      const data = await apiRequest<{ access_token: string }>("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registerBody)
      });
      setToken(data.access_token);
      const me = await apiRequest<MeProfile>("/auth/me", {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });
      applyMeProfile(me);
      router.push(`/dashboard/${dashboardLandingSection(me)}`);
    } catch (error) {
      const msg = (error as Error).message;
      flash(
        "authRegister",
        msg.includes("slug") || msg.includes("Tenant")
          ? `${msg} You can open “Customize name & ID” and change the workspace ID.`
          : msg,
        "error"
      );
    }
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    try {
      const data = await apiRequest<{ access_token: string }>("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      setToken(data.access_token);
      const me = await apiRequest<MeProfile>("/auth/me", {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });
      applyMeProfile(me);
      router.push(`/dashboard/${dashboardLandingSection(me)}`);
    } catch (error) {
      flash("authLogin", (error as Error).message, "error");
    }
  }

  async function handlePhoneSendOtp(event: FormEvent) {
    event.preventDefault();
    const e164 = normalizePhoneInputIndiaDefault(loginPhone);
    if (!E164_RE.test(e164)) {
      flash("authPhoneLogin", "Enter a valid mobile number (e.g. 9876543210 or +919876543210).", "error");
      return;
    }
    try {
      await apiRequest<{ detail: string }>("/auth/phone/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_e164: e164 })
      });
      setLoginPhone(e164);
      setOtpIssuedForE164(e164);
      flash("authPhoneLogin", "If this number is registered, you will receive a 6-digit code by SMS.", "success");
    } catch (error) {
      flash("authPhoneLogin", (error as Error).message, "error");
    }
  }

  async function handlePhoneVerifyOtp(event: FormEvent) {
    event.preventDefault();
    const e164 = normalizePhoneInputIndiaDefault(loginPhone);
    if (!E164_RE.test(e164)) {
      flash("authPhoneLogin", "Enter a valid mobile number.", "error");
      return;
    }
    const digits = loginOtp.replace(/\D/g, "").slice(0, 6);
    if (digits.length !== 6) {
      flash("authPhoneLogin", "Enter the 6-digit code from your SMS.", "error");
      return;
    }
    try {
      const data = await apiRequest<{ access_token: string }>("/auth/phone/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_e164: e164, code: digits })
      });
      setToken(data.access_token);
      const me = await apiRequest<MeProfile>("/auth/me", {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });
      applyMeProfile(me);
      router.push(`/dashboard/${dashboardLandingSection(me)}`);
    } catch (error) {
      flash("authPhoneLogin", (error as Error).message, "error");
    }
  }

  async function handleBindPhoneSendOtp(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const e164 = normalizePhoneInputIndiaDefault(bindPhone);
    if (!E164_RE.test(e164)) {
      flash("phoneBindSettings", "Enter a valid mobile number (e.g. 9876543210 or +919876543210).", "error");
      return;
    }
    try {
      await apiRequest<{ detail: string }>("/auth/phone/bind/request-otp", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ phone_e164: e164 })
      });
      setBindPhone(e164);
      setBindOtpIssuedForE164(e164);
      flash("phoneBindSettings", "Code sent. Enter it below, then save.", "success");
    } catch (error) {
      flash("phoneBindSettings", (error as Error).message, "error");
    }
  }

  async function handleBindPhoneVerifyOtp(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const e164 = normalizePhoneInputIndiaDefault(bindPhone);
    if (!E164_RE.test(e164)) {
      flash("phoneBindSettings", "Enter a valid mobile number.", "error");
      return;
    }
    const digits = bindOtp.replace(/\D/g, "").slice(0, 6);
    if (digits.length !== 6) {
      flash("phoneBindSettings", "Enter the 6-digit code from your SMS.", "error");
      return;
    }
    try {
      await apiRequest<{ phone_e164: string }>("/auth/phone/bind/verify-otp", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ phone_e164: e164, code: digits })
      });
      setProfilePhoneE164(e164);
      setBindOtp("");
      setBindOtpIssuedForE164(null);
      flash("phoneBindSettings", "Phone saved. You can sign in with SMS using this number.", "success");
    } catch (error) {
      flash("phoneBindSettings", (error as Error).message, "error");
    }
  }

  async function loadTags(resultSlot?: FeedbackSlot, quiet?: boolean) {
    try {
      const data = await apiRequest<Tag[]>("/crm/tags", { headers: authHeaders });
      setTags(data);
      if (resultSlot && !quiet) flash(resultSlot, "Tags updated.", "success");
    } catch (error) {
      if (resultSlot && !quiet) flash(resultSlot, (error as Error).message, "error");
    }
  }

  async function createTag(event: FormEvent) {
    event.preventDefault();
    if (!tagName.trim()) return;
    try {
      await apiRequest<Tag>("/crm/tags", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: tagName })
      });
      setTagName("");
      await loadTags();
      flash("tagCreate", "Tag added.", "success");
    } catch (error) {
      flash("tagCreate", (error as Error).message, "error");
    }
  }

  async function loadContacts(resultSlot?: FeedbackSlot, quiet?: boolean) {
    try {
      const data = await apiRequest<Contact[]>("/crm/contacts", { headers: authHeaders });
      setContactDirectory(data);
      if (!activeListTagId && !searchQuery.trim()) {
        setContacts(data);
      }
      if (resultSlot && !quiet) flash(resultSlot, "Contacts list updated.", "success");
    } catch (error) {
      if (resultSlot && !quiet) flash(resultSlot, (error as Error).message, "error");
    }
  }

  async function refreshContactList() {
    await loadContacts(undefined, true);
  }

  async function createContact(event: FormEvent) {
    event.preventDefault();
    if (!contactPhone.trim()) return;
    setCreatingContact(true);
    try {
      let customAttributes: Record<string, string> = {};
      if (attributesInput.trim()) {
        customAttributes = parseKeyValueInput(attributesInput);
      }
      const response = await fetch(`${API_BASE}/crm/contacts`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: contactName || null,
          phone_e164: contactPhone,
          custom_attributes: customAttributes,
          tag_ids: selectedTagIds
        })
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(formatApiErrorBody(raw, response.status));
      }
      const data = JSON.parse(raw) as Contact;
      setContactName("");
      setContactPhone("");
      setAttributesInput("");
      setSelectedTagIds([]);
      flash(
        "contactCreate",
        data.merged_with_existing ? "That contact was already in your list. We updated their details." : "Contact saved.",
        "success"
      );
      await loadContacts();
    } catch (error) {
      flash("contactCreate", (error as Error).message, "error");
    } finally {
      setCreatingContact(false);
    }
  }

  async function importContactsCsv(event: FormEvent) {
    event.preventDefault();
    if (!contactImportCsvFile) {
      flash("contactImport", "Choose a CSV file to import.", "error");
      return;
    }
    setImportingContacts(true);
    try {
      const fd = new FormData();
      fd.append("file", contactImportCsvFile);
      for (const tagId of contactImportTagIds) {
        fd.append("tag_ids", tagId);
      }
      const res = await fetch(`${API_BASE}/crm/contacts/import-csv`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const text = await res.text();
      if (!res.ok) throw new Error(formatApiErrorBody(text, res.status));
      const imported = JSON.parse(text) as {
        created_contacts: number;
        updated_contacts: number;
        tagged_contacts: number;
        skipped_rows: number;
      };
      flash(
        "contactImport",
        `Imported ${imported.created_contacts} new, updated ${imported.updated_contacts}, tagged ${imported.tagged_contacts} (${imported.skipped_rows} rows skipped).`,
        "success"
      );
      setContactImportCsvFile(null);
      setContactImportTagIds([]);
      await loadContacts();
    } catch (error) {
      flash("contactImport", (error as Error).message, "error");
    } finally {
      setImportingContacts(false);
    }
  }

  async function loadCampaigns(resultSlot?: FeedbackSlot, quiet?: boolean) {
    try {
      const data = await apiRequest<Campaign[]>("/campaigns", { headers: authHeaders });
      setCampaigns(data);
      if (resultSlot && !quiet) flash(resultSlot, "Campaigns updated.", "success");
    } catch (error) {
      if (resultSlot && !quiet) flash(resultSlot, (error as Error).message, "error");
    }
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault();
    if (!campaignName.trim() || !waTemplateName.trim()) {
      flash("campaignCreate", "Campaign name and an approved template are required.", "error");
      return;
    }
    const selected = approvedTemplates.find((t) => t.name === waTemplateName && t.language === waTemplateLanguage);
    if (!selected) {
      flash("campaignCreate", "Choose an approved template from the list.", "error");
      return;
    }
    if (campaignLaunchType === "contacts") {
      if (campaignTargetMode === "tags" && campaignTagIds.length === 0) {
        flash("campaignCreate", "Select at least one tag to target.", "error");
        return;
      }
      if (campaignTargetMode === "manual" && campaignContactIds.length === 0) {
        flash("campaignCreate", "Select at least one contact for a contact broadcast.", "error");
        return;
      }
    }
    if (campaignLaunchType === "csv" && !campaignCsvFile && !csvDraftCampaignId) {
      flash("campaignCreate", "Choose a CSV file to import recipients.", "error");
      return;
    }
    try {
      const created = await apiRequest<Campaign>("/campaigns", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: campaignName,
          template_name: waTemplateName,
          template_language: waTemplateLanguage,
          campaign_type: campaignLaunchType,
          contact_ids: campaignLaunchType === "contacts" && campaignTargetMode === "manual" ? campaignContactIds : [],
          tag_ids: campaignLaunchType === "contacts" && campaignTargetMode === "tags" ? campaignTagIds : [],
          template_variable_defaults: Object.fromEntries(
            Object.entries(campaignTemplateVars).filter(([, v]) => v.trim())
          )
        })
      });
      if (campaignLaunchType === "csv" && campaignCsvFile) {
        const fd = new FormData();
        fd.append("file", campaignCsvFile);
        const res = await fetch(`${API_BASE}/campaigns/${created.id}/import-csv`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
        const text = await res.text();
        if (!res.ok) throw new Error(formatApiErrorBody(text, res.status));
        const imported = JSON.parse(text) as { added_recipients: number; skipped_rows: number };
        flash(
          "campaignCreate",
          `CSV campaign created. Imported ${imported.added_recipients} recipients (${imported.skipped_rows} skipped).`,
          "success"
        );
        setCampaignCsvFile(null);
        setCsvDraftCampaignId(null);
      } else if (campaignLaunchType === "api") {
        setSelectedApiCampaignId(created.id);
        flash("campaignCreate", "API campaign created. Click Go Live, then use the integration API to trigger sends.", "success");
      } else {
        flash("campaignCreate", "Contact broadcast created. Click Start to send.", "success");
      }
      setCampaignName("");
      setCampaignContactIds([]);
      setCampaignTagIds([]);
      await loadCampaigns();
    } catch (error) {
      flash("campaignCreate", (error as Error).message, "error");
    }
  }

  async function importCsvToCampaign(campaignId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_BASE}/campaigns/${campaignId}/import-csv`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd
    });
    const text = await res.text();
    if (!res.ok) throw new Error(formatApiErrorBody(text, res.status));
    return JSON.parse(text) as { added_recipients: number; skipped_rows: number };
  }

  async function goLiveApiCampaign(campaignId: string) {
    try {
      await apiRequest<{ status: string; message: string }>(`/campaigns/${campaignId}/go-live`, {
        method: "POST",
        headers: authHeaders
      });
      setSelectedApiCampaignId(campaignId);
      await loadCampaigns();
      flash("campaignActions", "API campaign is live. Use POST /integrations/campaigns/{id}/trigger with your integration key.", "success");
    } catch (error) {
      flash("campaignActions", (error as Error).message, "error");
    }
  }

  function startApiCampaignFromTemplate(template: TemplateItem) {
    if (!isApprovedTemplate(template)) {
      flash("campaignCreate", "Template must be APPROVED in Meta before you can create an API campaign.", "error");
      return;
    }
    setCampaignLaunchType("api");
    setWaTemplateName(template.name);
    setWaTemplateLanguage(template.language);
    setCampaignName(`${template.name}_api`);
    setCampaignTemplateVars(initTemplateVarValues(template, null));
    setSelectedApiCampaignId(null);
    setActiveTab("campaigns");
    flash(
      "campaignCreate",
      `Prefilled API campaign for "${template.name}". Review the name and click Create API campaign, then Go Live.`,
      "success"
    );
  }

  async function startCampaign(campaignId: string) {
    try {
      await apiRequest<{ status: string; queued_count: number }>(`/campaigns/${campaignId}/start`, {
        method: "POST",
        headers: authHeaders
      });
      await loadCampaigns();
      flash("campaignActions", "Campaign started.", "success");
    } catch (error) {
      flash("campaignActions", (error as Error).message, "error");
    }
  }

  async function loadWhatsAppConnection(resultSlot?: FeedbackSlot) {
    try {
      const data = await apiRequest<{
        id: string;
        label: string;
        phone_number_id: string;
        waba_id: string | null;
        verify_token_configured: boolean;
        access_token_preview: string;
        app_secret_configured: boolean;
        is_default: boolean;
        is_active: boolean;
      } | null>("/whatsapp/connection", { headers: authHeaders });
      if (!data) {
        if (resultSlot) flash(resultSlot, "No saved connection yet. Add your Meta details below, then save.", "success");
        return;
      }
      setWaConnectionId(data.id || "");
      setWaLabel(data.label || "Primary");
      setWaPhoneNumberId(data.phone_number_id || "");
      setWaWabaId(data.waba_id || "");
      setWaVerifyToken("");
      setWaVerifyTokenConfigured(Boolean(data.verify_token_configured));
      setWaAccessTokenPreview(data.access_token_preview || "");
      setWaAppSecretConfigured(Boolean(data.app_secret_configured));
      setWaIsDefault(Boolean(data.is_default));
      setWaIsActive(Boolean(data.is_active));
      if (resultSlot) flash(resultSlot, "Connection details loaded.", "success");
    } catch (error) {
      if (resultSlot) flash(resultSlot, (error as Error).message, "error");
    }
  }

  async function loadWhatsAppConnections(resultSlot?: FeedbackSlot) {
    try {
      const data = await apiRequest<
        Array<{
          id: string;
          label: string;
          phone_number_id: string;
          waba_id: string | null;
          verify_token_configured: boolean;
          access_token_preview: string;
          app_secret_configured: boolean;
          is_default: boolean;
          is_active: boolean;
        }>
      >(
        "/whatsapp/connections",
        { headers: authHeaders }
      );
      setWaConnections(data);
      const preferred = data.find((item) => item.is_default) || data[0];
      if (preferred) {
        setWaConnectionId(preferred.id);
        setWaLabel(preferred.label);
        setWaPhoneNumberId(preferred.phone_number_id);
        setWaWabaId(preferred.waba_id || "");
        setWaVerifyToken("");
        setWaVerifyTokenConfigured(Boolean(preferred.verify_token_configured));
        setWaAccessTokenPreview(preferred.access_token_preview || "");
        setWaAppSecretConfigured(Boolean(preferred.app_secret_configured));
        setWaIsDefault(Boolean(preferred.is_default));
        setWaIsActive(Boolean(preferred.is_active));
      }
      if (resultSlot) flash(resultSlot, "Connection list refreshed.", "success");
    } catch (error) {
      if (resultSlot) flash(resultSlot, (error as Error).message, "error");
    }
  }

  function applySelectedConnection(connectionId: string) {
    const item = waConnections.find((x) => x.id === connectionId);
    if (!item) return;
    setWaConnectionId(item.id);
    setWaLabel(item.label);
    setWaPhoneNumberId(item.phone_number_id);
    setWaWabaId(item.waba_id || "");
    setWaVerifyToken("");
    setWaVerifyTokenConfigured(Boolean(item.verify_token_configured));
    setWaAccessTokenPreview(item.access_token_preview || "");
    setWaAppSecretConfigured(Boolean(item.app_secret_configured));
    setWaIsDefault(Boolean(item.is_default));
    setWaIsActive(Boolean(item.is_active));
  }

  async function deleteSelectedConnection() {
    if (!waConnectionId) return;
    try {
      await apiRequest(`/whatsapp/connections/${waConnectionId}`, {
        method: "DELETE",
        headers: authHeaders
      });
      flash("waConnectionForm", "Connection removed.", "success");
      setWaConnectionId("");
      setWaLabel("Primary");
      setWaPhoneNumberId("");
      setWaWabaId("");
      setWaAccessToken("");
      setWaVerifyToken("");
      setWaVerifyTokenConfigured(false);
      setWaAppSecret("");
      setWaIsDefault(true);
      setWaIsActive(true);
      await loadWhatsAppConnections();
    } catch (error) {
      flash("waConnectionForm", (error as Error).message, "error");
    }
  }

  async function saveWhatsAppConnection(event: FormEvent) {
    event.preventDefault();
    setSavingWaConnection(true);
    try {
      const accessTokenValue = waAccessToken.trim();
      const verifyTokenValue = waVerifyToken.trim();
      const appSecretValue = waAppSecret.trim();
      await apiRequest("/whatsapp/connection", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          connection_id: waConnectionId || null,
          label: waLabel,
          phone_number_id: waPhoneNumberId,
          waba_id: waWabaId || null,
          access_token: accessTokenValue || null,
          verify_token: verifyTokenValue || null,
          app_secret: appSecretValue || null,
          is_default: waIsDefault,
          is_active: waIsActive
        })
      });
      flash("waConnectionForm", "Connection saved.", "success");
      await loadWhatsAppConnection();
      await loadWhatsAppConnections();
      await loadConnectionHealth();
      const me = await apiRequest<MeProfile>("/auth/me", { headers: authHeaders });
      applyMeProfile(me);
      if (me.memberships?.[0]?.setup_status === "active") {
        flash("waConnectionForm", "WhatsApp connected — your workspace is now active.", "success");
      }
    } catch (error) {
      flash("waConnectionForm", (error as Error).message, "error");
    } finally {
      setSavingWaConnection(false);
    }
  }

  useEffect(() => {
    if (!token || activeTab !== "settings") return;
    loadWhatsAppConnection();
    loadWhatsAppConnections();
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab]);

  useEffect(() => {
    if (!token || isSuperAdmin || agentNeedsSetup) return;
    void loadConnectionHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isSuperAdmin, agentNeedsSetup]);

  async function loadConnectionHealth() {
    try {
      const q = waConnectionId ? `?connection_id=${encodeURIComponent(waConnectionId)}` : "";
      const data = await apiRequest<{
        overall: string;
        hints: string[];
        token_valid: boolean;
        token_alert?: string | null;
        token_alert_message?: string | null;
        token_error?: string | null;
        waba_configured: boolean;
        webhook_ready: boolean;
        connection_configured: boolean;
      }>(`/whatsapp/connection-health${q}`, { headers: authHeaders });
      setConnectionHealth(data);
    } catch {
      setConnectionHealth(null);
    }
  }

  useEffect(() => {
    if (!token || activeTab !== "settings") return;
    loadConnectionHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab, waConnectionId]);

  async function submitQuickTemplateToContact() {
    if (!quickSendContact || !quickTemplateKey) {
      flash("contactQuickSend", "Choose a template first.", "error");
      return;
    }
    const template = getSelectedTemplate(quickTemplateKey, templateItems);
    const err = validateTemplateVarValues(template?.body_variables ?? [], quickTemplateVars, template?.category);
    if (err) {
      flash("contactQuickSend", err, "error");
      return;
    }
    const payload = buildTemplateSendPayload(quickTemplateKey, templateItems, quickSendContact.name, quickTemplateVars);
    if (!payload) return;
    setSendingQuickTemplate(true);
    try {
      await apiRequest<{ message_id?: string }>("/whatsapp/send-template-test", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          connection_id: waConnectionId || null,
          to_phone_e164: quickSendContact.phone_e164,
          ...payload
        })
      });
      flash("contactQuickSend", "Template sent.", "success");
      setQuickSendContact(null);
      setQuickTemplateKey("");
    } catch (error) {
      flash("contactQuickSend", (error as Error).message, "error");
    } finally {
      setSendingQuickTemplate(false);
    }
  }

  async function sendInboxTemplate() {
    if (!selectedConversation || !inboxTemplateKey) {
      flash("inboxTemplate", "Select a conversation and template first.", "error");
      return;
    }
    const template = getSelectedTemplate(inboxTemplateKey, templateItems);
    const err = validateTemplateVarValues(template?.body_variables ?? [], inboxTemplateVars, template?.category);
    if (err) {
      flash("inboxTemplate", err, "error");
      return;
    }
    const payload = buildTemplateSendPayload(
      inboxTemplateKey,
      templateItems,
      selectedConversation.contact_name,
      inboxTemplateVars
    );
    if (!payload) return;
    setSendingInboxTemplate(true);
    try {
      await apiRequest<{ message_id?: string }>("/whatsapp/send-template-test", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          connection_id: waConnectionId || null,
          to_phone_e164: selectedConversation.phone_e164,
          ...payload
        })
      });
      await loadConversationMessages(selectedConversation);
      flash("inboxTemplate", "Template sent.", "success");
    } catch (error) {
      flash("inboxTemplate", (error as Error).message, "error");
    } finally {
      setSendingInboxTemplate(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    if (activeTab === "contacts") {
      loadTags();
      loadContacts();
      loadTemplates();
      loadWhatsAppConnection();
      return;
    }
    if (activeTab === "campaigns") {
      loadTags();
      loadCampaigns();
      loadContacts();
      loadTemplates();
      return;
    }
    if (activeTab === "templates") {
      loadWhatsAppConnections();
      loadTemplates();
      return;
    }
    if (activeTab === "inbox") {
      loadTags();
      loadConversations();
      loadTemplates();
      loadWhatsAppConnection();
      return;
    }
    if (activeTab === "analytics") {
      loadTags();
      loadCampaigns();
      loadContacts();
      loadTemplates(undefined, true);
      return;
    }
    if (activeTab === "integrations") {
      void loadIntegrationKeys(true);
      void loadExternalWebhookStatus(true);
      void loadCampaigns(undefined, true);
      void loadTemplates(undefined, true);
      return;
    }
    if (activeTab === "platform" && isSuperAdmin) {
      if (platformMonitorTenantId) {
        void loadPlatformAgentOverview(platformMonitorTenantId, true);
      } else {
        void loadPlatformData(true);
      }
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab, isSuperAdmin, platformMonitorTenantId]);

  useEffect(() => {
    setPlatformMonitorTenantId(initialPlatformMonitorTenantId ?? null);
  }, [initialPlatformMonitorTenantId]);

  useEffect(() => {
    if (!token || activeTab !== "analytics") return;
    void loadTagPerformance(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab, tagPerfDays]);

  useEffect(() => {
    if (!token || mode !== "dashboard") return;
    void refreshDashboardSnapshot(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, mode]);

  useEffect(() => {
    const order = positionalPlaceholderOrder(createTplBody);
    setCreateTplVarRows((prev) => order.map((_, i) => prev[i] ?? { paramName: "", example: "" }));
  }, [createTplBody]);

  useEffect(() => {
    if (!token || activeTab !== "inbox") return;

    refreshInboxSilently();
    const intervalId = window.setInterval(() => {
      refreshInboxSilently();
    }, 7000);

    return () => {
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab, selectedConversation?.conversation_id]);

  useEffect(() => {
    setInboxTemplateKey("");
    setInboxTemplateVars({});
  }, [selectedConversation?.conversation_id]);

  useEffect(() => {
    if (!inboxTemplateKey) {
      setInboxTemplateVars({});
      return;
    }
    const t = getSelectedTemplate(inboxTemplateKey, templateItems);
    setInboxTemplateVars(initTemplateVarValues(t, selectedConversation?.contact_name ?? null));
  }, [inboxTemplateKey, selectedConversation?.contact_name, templateItems]);

  useEffect(() => {
    if (!quickTemplateKey) {
      setQuickTemplateVars({});
      return;
    }
    const t = getSelectedTemplate(quickTemplateKey, templateItems);
    setQuickTemplateVars(initTemplateVarValues(t, quickSendContact?.name ?? null));
  }, [quickTemplateKey, quickSendContact?.name, templateItems]);

  useEffect(() => {
    const key =
      waTemplateName && waTemplateLanguage ? `${waTemplateName}__${waTemplateLanguage}` : "";
    if (!key) {
      setCampaignTemplateVars({});
      return;
    }
    const t = getSelectedTemplate(key, approvedTemplates);
    setCampaignTemplateVars(initTemplateVarValues(t, null));
  }, [waTemplateName, waTemplateLanguage, approvedTemplates]);

  async function sendTemplateTest(event: FormEvent) {
    event.preventDefault();
    setSendingTemplateTest(true);
    try {
      await apiRequest<{ message_id?: string }>("/whatsapp/send-template-test", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          connection_id: waConnectionId || null,
          to_phone_e164: waTestToPhone,
          template_name: waTemplateName,
          language_code: waTemplateLanguage
        })
      });
      flash("waTemplateTest", "Test template sent.", "success");
    } catch (error) {
      flash("waTemplateTest", (error as Error).message, "error");
    } finally {
      setSendingTemplateTest(false);
    }
  }

  async function syncTemplates(resultSlot?: FeedbackSlot) {
    try {
      const data = await apiRequest<TemplateItem[]>("/whatsapp/templates/sync", {
        method: "POST",
        headers: authHeaders
      });
      setTemplateItems(data);
      if (!waTemplateName && data.length > 0) {
        setWaTemplateName(data[0].name);
        setWaTemplateLanguage(data[0].language);
      }
      if (resultSlot) flash(resultSlot, "Templates synced from Meta.", "success");
    } catch (error) {
      if (resultSlot) flash(resultSlot, (error as Error).message, "error");
    }
  }

  async function createTemplateInMeta(event: FormEvent) {
    event.preventDefault();
    const nameNorm = createTplName.trim().toLowerCase();
    if (!nameNorm || !createTplBody.trim()) {
      flash("templateCreate", "Template name and body are required.", "error");
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(nameNorm) || nameNorm.length < 3) {
      flash(
        "templateCreate",
        "Template name must be at least 3 characters, start with a letter, and use only lowercase letters, numbers, and underscores.",
        "error"
      );
      return;
    }
    const langCode = (createTplLanguageCustom.trim() || createTplLanguageSelect.trim()).trim();
    if (!langCode) {
      flash("templateCreate", "Choose a template language or enter a custom locale code.", "error");
      return;
    }
    const phOrder = positionalPlaceholderOrder(createTplBody);
    if (phOrder.length) {
      for (let i = 0; i < phOrder.length; i++) {
        const row = createTplVarRows[i];
        const pName = (row?.paramName ?? "").trim().toLowerCase();
        const ex = (row?.example ?? "").trim();
        if (!pName || !ex) {
          flash(
            "templateCreate",
            `Add a variable name and sample value for each placeholder (row for {{${phOrder[i]}}}).`,
            "error"
          );
          return;
        }
        if (!/^[a-z][a-z0-9_]*$/.test(pName)) {
          flash(
            "templateCreate",
            `Variable names must start with a letter and use only lowercase letters, numbers, and underscores (see {{${phOrder[i]}}}).`,
            "error"
          );
          return;
        }
      }
      const names = phOrder.map((_, i) => createTplVarRows[i].paramName.trim().toLowerCase());
      if (new Set(names).size !== names.length) {
        flash("templateCreate", "Each variable name must be unique.", "error");
        return;
      }
    }
    setCreatingTemplate(true);
    try {
      await apiRequest<{ success: boolean }>("/whatsapp/templates/create", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: nameNorm,
          language: langCode,
          category: createTplCategory,
          body_text: createTplBody,
          header_text: createTplHeader.trim() || null,
          footer_text: createTplFooter.trim() || null,
          body_variables:
            phOrder.length > 0
              ? phOrder.map((_, i) => ({
                  param_name: createTplVarRows[i].paramName.trim().toLowerCase(),
                  example: createTplVarRows[i].example.trim()
                }))
              : null,
          allow_category_change: createTplAllowCat
        })
      });
      flash(
        "templateCreate",
        "Template submitted to Meta for review. Sync from Meta in a minute to refresh status.",
        "success"
      );
      await loadTemplates();
      await syncTemplates();
    } catch (error) {
      flash("templateCreate", (error as Error).message, "error");
    } finally {
      setCreatingTemplate(false);
    }
  }

  async function loadTemplates(resultSlot?: FeedbackSlot, quiet?: boolean) {
    try {
      const data = await apiRequest<TemplateItem[]>("/whatsapp/templates", { headers: authHeaders });
      setTemplateItems(data);
      if (resultSlot && !quiet) flash(resultSlot, "Template library refreshed.", "success");
    } catch (error) {
      if (resultSlot && !quiet) flash(resultSlot, (error as Error).message, "error");
    }
  }

  async function loadConversations(resultSlot?: FeedbackSlot, quiet?: boolean) {
    try {
      const data = await apiRequest<ConversationItem[]>("/whatsapp/conversations", { headers: authHeaders });
      setConversations(data);
      setInboxLastSyncedAt(new Date().toLocaleTimeString());
      if (resultSlot && !quiet) flash(resultSlot, "Inbox refreshed.", "success");
    } catch (error) {
      if (!quiet) flash(resultSlot ?? "inboxList", (error as Error).message, "error");
    }
  }

  async function refreshDashboardSnapshot(showToast: boolean) {
    if (!token) return;
    setStatsSnapshotRefreshing(true);
    try {
      const results = await Promise.allSettled([
        loadTags(undefined, true),
        loadContacts(undefined, true),
        loadCampaigns(undefined, true),
        loadTemplates(undefined, true),
        loadConversations(undefined, true),
        loadWhatsAppConnections()
      ]);
      setStatsUpdatedAt(new Date());
      setStatsSnapshotLoaded(true);
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (showToast) {
        if (failed?.reason instanceof Error) flash("sectionRefresh", failed.reason.message, "error");
        else if (failed) flash("sectionRefresh", String(failed.reason), "error");
        else flash("sectionRefresh", "Workspace data refreshed.", "success");
      }
    } finally {
      setStatsSnapshotRefreshing(false);
    }
  }

  async function loadPlatformData(quiet?: boolean) {
    if (!isSuperAdmin) return;
    setPlatformLoading(true);
    try {
      const [summary, tenants] = await Promise.all([
        apiRequest<{
          agents_total: number;
          agents_active: number;
          agents_pending_meta: number;
          agents_disabled: number;
          agents_token_attention: number;
          users: number;
          whatsapp_connections: number;
        }>("/platform/summary", { headers: authHeaders }),
        apiRequest<PlatformTenantRow[]>("/platform/agents", { headers: authHeaders })
      ]);
      setPlatformSummary(summary);
      setPlatformTenants(tenants);
      if (!quiet) flash("platformPanel", "Platform data refreshed.", "success");
    } catch (error) {
      if (!quiet) flash("platformPanel", (error as Error).message, "error");
    } finally {
      setPlatformLoading(false);
    }
  }

  async function toggleAgentActive(tenantId: string, enable: boolean) {
    setAgentActionLoading(true);
    try {
      await apiRequest(`/platform/agents/${tenantId}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ is_active: enable })
      });
      flash("platformPanel", enable ? "Agent account enabled." : "Agent account disabled.", "success");
      await loadPlatformData(true);
    } catch (error) {
      flash("platformPanel", (error as Error).message, "error");
    } finally {
      setAgentActionLoading(false);
    }
  }

  async function submitAgentPasswordReset(tenantId: string) {
    if (agentResetPassword.length < 8) {
      flash("platformPanel", "Password must be at least 8 characters.", "error");
      return;
    }
    setAgentActionLoading(true);
    try {
      await apiRequest(`/platform/agents/${tenantId}/reset-password`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ password: agentResetPassword })
      });
      setAgentActionTenantId(null);
      setAgentResetPassword("");
      flash("platformPanel", "Agent password reset. Share the new password securely.", "success");
      await loadPlatformData(true);
    } catch (error) {
      flash("platformPanel", (error as Error).message, "error");
    } finally {
      setAgentActionLoading(false);
    }
  }

  async function loadPlatformAgentOverview(tenantId: string, quiet?: boolean) {
    if (!isSuperAdmin) return;
    setPlatformOverviewLoading(true);
    try {
      const [overview, conversations] = await Promise.all([
        apiRequest<PlatformAgentOverview>(`/platform/agents/${tenantId}/overview`, { headers: authHeaders }),
        apiRequest<{ total: number; items: ConversationItem[] }>(`/platform/agents/${tenantId}/conversations?limit=50`, {
          headers: authHeaders
        })
      ]);
      setPlatformOverview(overview);
      setPlatformMonitorConversations(conversations.items);
      const keep =
        platformMonitorConversation &&
        conversations.items.some((item) => item.conversation_id === platformMonitorConversation.conversation_id)
          ? platformMonitorConversation
          : conversations.items[0] ?? null;
      setPlatformMonitorConversation(keep);
      if (keep) {
        await loadPlatformMonitorMessages(tenantId, keep.conversation_id, true);
      } else {
        setPlatformMonitorMessages([]);
      }
      if (!quiet) flash("platformMonitor", "Agent workspace snapshot refreshed.", "success");
    } catch (error) {
      if (!quiet) flash("platformMonitor", (error as Error).message, "error");
    } finally {
      setPlatformOverviewLoading(false);
    }
  }

  async function loadPlatformMonitorMessages(tenantId: string, conversationId: string, quiet?: boolean) {
    setPlatformMonitorMessagesLoading(true);
    try {
      const data = await apiRequest<MonitorMessage[]>(
        `/platform/agents/${tenantId}/conversations/${conversationId}/messages`,
        { headers: authHeaders }
      );
      setPlatformMonitorMessages(data);
      if (!quiet) flash("platformMonitor", "Conversation thread loaded.", "success");
    } catch (error) {
      if (!quiet) flash("platformMonitor", (error as Error).message, "error");
    } finally {
      setPlatformMonitorMessagesLoading(false);
    }
  }

  function openPlatformMonitor(tenantId: string) {
    setPlatformMonitorTenantId(tenantId);
    router.push(`/dashboard/platform/${tenantId}`);
  }

  function closePlatformMonitor() {
    setPlatformMonitorTenantId(null);
    setPlatformOverview(null);
    setPlatformMonitorConversations([]);
    setPlatformMonitorConversation(null);
    setPlatformMonitorMessages([]);
    router.push("/dashboard/platform");
  }

  async function submitPlatformDelete() {
    if (!platformDeleteTarget) return;
    if (platformDeleteConfirmSlug.trim().toLowerCase() !== platformDeleteTarget.tenant_slug.trim().toLowerCase()) {
      flash("platformPanel", "Type the exact workspace ID to confirm deletion.", "error");
      return;
    }
    setPlatformDeleting(true);
    const deletedId = platformDeleteTarget.tenant_id;
    const deletedName = platformDeleteTarget.tenant_name;
    try {
      await apiRequest(`/platform/agents/${deletedId}`, {
        method: "DELETE",
        headers: authHeaders,
        body: JSON.stringify({ confirm_slug: platformDeleteConfirmSlug.trim() })
      });
      setPlatformDeleteTarget(null);
      setPlatformDeleteConfirmSlug("");
      if (platformMonitorTenantId === deletedId) {
        closePlatformMonitor();
      }
      flash("platformPanel", `Deleted workspace “${deletedName}” and all associated data.`, "success");
      await loadPlatformData(true);
    } catch (error) {
      flash("platformPanel", (error as Error).message, "error");
    } finally {
      setPlatformDeleting(false);
    }
  }

  async function handleCreateAgent(event: FormEvent) {
    event.preventDefault();
    if (!isSuperAdmin) return;
    const tenantName = newAgentTenantName.trim();
    let tenantSlug = newAgentTenantSlug.trim().toLowerCase();
    if (!tenantSlug) {
      tenantSlug = slugifyWorkspaceName(tenantName);
    }
    if (tenantName.length < 2) {
      flash("platformPanel", "Workspace name must be at least 2 characters.", "error");
      return;
    }
    if (!tenantSlug || tenantSlug.length < 2) {
      flash("platformPanel", "Could not build a workspace ID from that name. Use letters or numbers.", "error");
      return;
    }
    setCreatingAgent(true);
    try {
      await apiRequest("/platform/agents", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          email: newAgentEmail.trim(),
          password: newAgentPassword,
          full_name: newAgentFullName.trim() || null,
          tenant_name: tenantName,
          tenant_slug: tenantSlug
        })
      });
      setNewAgentEmail("");
      setNewAgentPassword("");
      setNewAgentFullName("");
      setNewAgentTenantName("");
      setNewAgentTenantSlug("");
      setNewAgentSlugManual(false);
      flash("platformPanel", "Agent account created. Share login credentials with the agent.", "success");
      await loadPlatformData(true);
    } catch (error) {
      flash("platformPanel", (error as Error).message, "error");
    } finally {
      setCreatingAgent(false);
    }
  }

  async function loadIntegrationKeys(quiet?: boolean) {
    setIntegrationKeysLoading(true);
    try {
      const data = await apiRequest<Array<{ id: string; label: string | null; is_active: boolean; created_at: string }>>(
        "/admin/integration-keys",
        { headers: authHeaders }
      );
      setIntegrationKeys(data);
      if (!quiet) flash("integrationPanel", "Integration keys updated.", "success");
    } catch (error) {
      if (!quiet) flash("integrationPanel", (error as Error).message, "error");
    } finally {
      setIntegrationKeysLoading(false);
    }
  }

  async function createIntegrationKey(event: FormEvent) {
    event.preventDefault();
    setCreatingIntegrationKey(true);
    try {
      const data = await apiRequest<{ id: string; api_key: string; label: string | null }>("/admin/integration-keys", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ label: newIntegrationLabel.trim() || null })
      });
      setRevealedIntegrationKey(data.api_key);
      setNewIntegrationLabel("");
      await loadIntegrationKeys(true);
      flash("integrationPanel", "Key created. Copy it now — it will not be shown again.", "success");
    } catch (error) {
      flash("integrationPanel", (error as Error).message, "error");
    } finally {
      setCreatingIntegrationKey(false);
    }
  }

  async function revokeIntegrationKey(keyId: string) {
    try {
      await apiRequestNoContent(`/admin/integration-keys/${keyId}`, { method: "DELETE", headers: authHeaders });
      await loadIntegrationKeys(true);
      flash("integrationPanel", "Key revoked.", "success");
    } catch (error) {
      flash("integrationPanel", (error as Error).message, "error");
    }
  }

  async function loadExternalWebhookStatus(quiet?: boolean) {
    try {
      const data = await apiRequest<{ configured: boolean; url_host: string; signing_enabled: boolean }>(
        "/admin/external-crm-webhook/status",
        { headers: authHeaders }
      );
      setExternalWebhookStatus(data);
      if (!quiet) flash("integrationPanel", "Outbound webhook status updated.", "success");
    } catch (error) {
      if (!quiet) flash("integrationPanel", (error as Error).message, "error");
    }
  }

  async function testExternalCrmWebhook() {
    setTestingExternalWebhook(true);
    try {
      const data = await apiRequest<{ success: boolean; message: string }>("/admin/external-crm-webhook/test", {
        method: "POST",
        headers: authHeaders
      });
      flash("integrationPanel", data.message || "Test delivered.", "success");
    } catch (error) {
      flash("integrationPanel", (error as Error).message, "error");
    } finally {
      setTestingExternalWebhook(false);
    }
  }

  async function loadMetaPricingAnalytics() {
    if (!token) return;
    setMetaPricingLoading(true);
    try {
      const endTs = Math.floor(Date.now() / 1000);
      const startTs = endTs - metaPricingDays * 24 * 3600;
      const q = new URLSearchParams({
        start_ts: String(startTs),
        end_ts: String(endTs),
        granularity: metaPricingGranularity
      });
      if (metaPricingCountryFilter.trim()) {
        q.set("country_codes", metaPricingCountryFilter.trim().toUpperCase());
      }
      const data = await apiRequest<MetaPricingResponse>(`/analytics/meta-pricing?${q}`, { headers: authHeaders });
      setMetaPricingData(data);
      flash("metaPricing", "Loaded Meta pricing analytics.", "success");
    } catch (error) {
      flash("metaPricing", (error as Error).message, "error");
    } finally {
      setMetaPricingLoading(false);
    }
  }

  async function loadTagPerformance(quiet?: boolean) {
    if (!token) return;
    setTagPerfLoading(true);
    try {
      const q = new URLSearchParams();
      if (tagPerfDays > 0) {
        const endTs = Math.floor(Date.now() / 1000);
        const startTs = endTs - tagPerfDays * 24 * 3600;
        q.set("start_ts", String(startTs));
        q.set("end_ts", String(endTs));
      }
      const path = q.toString() ? `/analytics/tag-performance?${q}` : "/analytics/tag-performance";
      const data = await apiRequest<TagPerformanceResponse>(path, { headers: authHeaders });
      setTagPerfData(data);
      if (!quiet) flash("tagPerf", "Tag performance updated.", "success");
    } catch (error) {
      if (!quiet) flash("tagPerf", (error as Error).message, "error");
    } finally {
      setTagPerfLoading(false);
    }
  }

  async function loadConversationMessages(conversation: ConversationItem, resultSlot?: FeedbackSlot) {
    try {
      const data = await apiRequest<ConversationMessage[]>(`/whatsapp/conversations/${conversation.conversation_id}/messages`, {
        headers: authHeaders
      });
      setSelectedConversation(conversation);
      setConversationMessages(data);
      setInboxLastSyncedAt(new Date().toLocaleTimeString());
      if (resultSlot) flash(resultSlot, "Conversation loaded.", "success");
    } catch (error) {
      flash(resultSlot ?? "inboxThread", (error as Error).message, "error");
    }
  }

  async function refreshInboxSilently() {
    try {
      const conversationData = await apiRequest<ConversationItem[]>("/whatsapp/conversations", { headers: authHeaders });
      setConversations(conversationData);

      if (!selectedConversation) return;
      const stillExists = conversationData.find((item) => item.conversation_id === selectedConversation.conversation_id);
      if (!stillExists) {
        setSelectedConversation(null);
        setConversationMessages([]);
        return;
      }

      const messageData = await apiRequest<ConversationMessage[]>(
        `/whatsapp/conversations/${stillExists.conversation_id}/messages`,
        { headers: authHeaders }
      );
      setSelectedConversation(stillExists);
      setConversationMessages(messageData);
      setInboxLastSyncedAt(new Date().toLocaleTimeString());
    } catch {
      // Silent polling should not override user-visible status.
    }
  }

  function clearReplyAttachment() {
    setReplyAttachment(null);
    if (replyFileInputRef.current) replyFileInputRef.current.value = "";
  }

  async function sendReplyWithMedia() {
    if (!selectedConversation || !replyAttachment || !token) return;
    if (selectedConversation.messaging_window && !selectedConversation.messaging_window.can_send_session) {
      flash("inboxReply", selectedConversation.messaging_window.session_hint, "error");
      return;
    }
    setSendingReply(true);
    try {
      const fd = new FormData();
      fd.append("file", replyAttachment);
      fd.append("conversation_id", selectedConversation.conversation_id);
      fd.append("to_phone_e164", selectedConversation.phone_e164);
      if (waConnectionId.trim()) fd.append("connection_id", waConnectionId.trim());
      if (replyText.trim()) fd.append("caption", replyText.trim());
      const res = await fetch(`${API_BASE}/whatsapp/reply-media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const text = await res.text();
      if (!res.ok) throw new Error(formatApiErrorBody(text, res.status));
      setReplyText("");
      clearReplyAttachment();
      await loadConversationMessages(selectedConversation);
      flash("inboxReply", "Message sent.", "success");
    } catch (error) {
      flash("inboxReply", (error as Error).message, "error");
    } finally {
      setSendingReply(false);
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selectedConversation) return;
    if (selectedConversation.messaging_window && !selectedConversation.messaging_window.can_send_session) {
      flash("inboxReply", selectedConversation.messaging_window.session_hint, "error");
      return;
    }
    if (replyAttachment) {
      await sendReplyWithMedia();
      return;
    }
    if (!replyText.trim()) return;
    setSendingReply(true);
    try {
      await apiRequest("/whatsapp/reply-text", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          connection_id: waConnectionId || null,
          conversation_id: selectedConversation.conversation_id,
          to_phone_e164: selectedConversation.phone_e164,
          text: replyText
        })
      });
      setReplyText("");
      await loadConversationMessages(selectedConversation);
      flash("inboxReply", "Message sent.", "success");
    } catch (error) {
      flash("inboxReply", (error as Error).message, "error");
    } finally {
      setSendingReply(false);
    }
  }

  async function deleteContact(contactId: string) {
    try {
      await apiRequest(`/crm/contacts/${contactId}`, {
        method: "DELETE",
        headers: authHeaders
      });
      flash("contactList", "Contact removed.", "success");
      await loadContacts();
    } catch (error) {
      flash("contactList", (error as Error).message, "error");
    }
  }

  async function updateContact(event: FormEvent) {
    event.preventDefault();
    if (!editingContactId) return;
    try {
      let customAttributes: Record<string, string> | null = null;
      if (editAttributesInput.trim()) {
        customAttributes = parseKeyValueInput(editAttributesInput);
      }
      await apiRequest<Contact>(`/crm/contacts/${editingContactId}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          name: editName || null,
          phone_e164: editPhone,
          custom_attributes: customAttributes,
          tag_ids: editTagIds
        })
      });
      flash("contactEdit", "Contact updated.", "success");
      clearEditForm();
      await loadContacts();
    } catch (error) {
      flash("contactEdit", (error as Error).message, "error");
    }
  }

  function parseKeyValueInput(input: string): Record<string, string> {
    // Format: key:value,city:Mumbai
    const output: Record<string, string> = {};
    const pairs = input.split(",").map((item) => item.trim()).filter(Boolean);
    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split(":");
      const value = valueParts.join(":").trim();
      if (key?.trim() && value) {
        output[key.trim()] = value;
      }
    }
    return output;
  }

  function getMessageDisplayText(payload: Record<string, unknown> | undefined, messageType: string): string {
    if (!payload) return "";
    if (messageType === "template") {
      const preview = payload.preview_text;
      if (typeof preview === "string" && preview.trim()) {
        return preview.trim();
      }
      const name = payload.template_name;
      const lang = payload.language_code;
      if (typeof name === "string" && name.trim()) {
        const lc = typeof lang === "string" && lang.trim() ? ` (${lang.trim()})` : "";
        return `Template: ${name.trim()}${lc} — sync templates from Meta to show message text here.`;
      }
    }
    const textField = payload.text;
    if (typeof textField === "string") return textField;
    if (textField && typeof textField === "object" && !Array.isArray(textField)) {
      const body = (textField as { body?: unknown }).body;
      if (typeof body === "string") return body;
    }
    if (messageType === "image" && payload.image && typeof payload.image === "object") {
      const cap = (payload.image as { caption?: string }).caption;
      return cap?.trim() ? cap : "[Image]";
    }
    if (messageType === "document" && payload.document && typeof payload.document === "object") {
      const doc = payload.document as { filename?: string; caption?: string };
      if (doc.caption?.trim()) return doc.caption;
      if (doc.filename) return `[Document: ${doc.filename}]`;
      return "[Document]";
    }
    if (messageType === "audio") return "[Audio]";
    if (messageType === "video") return "[Video]";
    if (messageType === "sticker") return "[Sticker]";
    if (messageType === "location") return "[Location]";
    if (messageType === "contacts") return "[Contacts]";
    if (messageType === "interactive" && payload.interactive && typeof payload.interactive === "object") {
      const i = payload.interactive as { type?: string; button_reply?: { title?: string }; list_reply?: { title?: string } };
      if (i.type === "button_reply" && i.button_reply?.title) return i.button_reply.title;
      if (i.type === "list_reply" && i.list_reply?.title) return i.list_reply.title;
      return "[Interactive]";
    }
    return `[${messageType || "message"}]`;
  }

  function startEdit(contact: Contact) {
    setEditingContactId(contact.id);
    setEditName(contact.name || "");
    setEditPhone(contact.phone_e164);
    setEditTagIds(contact.tags.map((tag) => tag.id));
    const attrs = Object.entries(contact.custom_attributes || {})
      .map(([key, value]) => `${key}:${String(value)}`)
      .join(",");
    setEditAttributesInput(attrs);
  }

  function clearEditForm() {
    setEditingContactId(null);
    setEditName("");
    setEditPhone("");
    setEditAttributesInput("");
    setEditTagIds([]);
  }

  function handleLogout() {
    sessionExpiredHandledRef.current = false;
    setToken("");
    router.push("/login");
  }

  const showAuth = mode === "auth" || !token;
  const isRedirecting = !hydrated || mode === "root" || (mode === "dashboard" && !token);

  if (isRedirecting) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-crm-surface via-crm-void to-black p-6">
        <div className="mx-auto max-w-7xl">
          <section
            className={`flex items-center justify-center rounded-2xl border border-crm-border bg-crm-elevated/80 py-20 shadow-glow`}
          >
            <div className="flex flex-col items-center gap-3">
              <Spinner className="h-8 w-8 text-crm-accent" />
              <p className="text-sm font-medium text-zinc-300">Loading workspace…</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-crm-surface via-crm-void to-black p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-crm-accent/20 bg-crm-elevated/90 p-5 shadow-glow backdrop-blur-md">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              WhatsApp <span className="text-crm-accent">CRM</span>
            </h1>
            <p className="mt-0.5 text-xs text-zinc-500">
              API: <code className="rounded bg-black/50 px-1.5 py-0.5 text-zinc-400">{API_BASE}</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                token ? "bg-lime-500/20 text-lime-400 ring-1 ring-lime-500/30" : "bg-zinc-800 text-zinc-400 ring-1 ring-zinc-600"
              }`}
            >
              {token ? "Signed in" : "Guest"}
            </span>
            {token && (
              <button
                className="rounded-xl border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:border-crm-accent/50 hover:text-crm-accent"
                onClick={handleLogout}
              >
                Logout
              </button>
            )}
          </div>
        </header>

        {showAuth ? (
          <div className="mx-auto max-w-lg space-y-6">
            <div className="text-center">
              <p className="text-sm text-zinc-400">Secure access to your WhatsApp workspace</p>
            </div>
            {allowOpenRegistration ? (
              <div className="flex rounded-2xl border border-crm-border bg-crm-elevated/50 p-1 shadow-inner">
                <button
                  type="button"
                  className={`flex-1 rounded-xl py-3 text-sm font-bold transition ${
                    authPanel === "login"
                      ? "bg-crm-accent text-black shadow-md"
                      : "text-zinc-400 hover:text-white"
                  }`}
                  onClick={() => setAuthPanel("login")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-xl py-3 text-sm font-bold transition ${
                    authPanel === "register"
                      ? "bg-crm-accent text-black shadow-md"
                      : "text-zinc-400 hover:text-white"
                  }`}
                  onClick={() => {
                    setRegisterCustomizeWorkspace(false);
                    setAuthPanel("register");
                  }}
                >
                  Create account
                </button>
              </div>
            ) : (
              <p className="rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-3 text-center text-sm text-zinc-400">
                Accounts are created by your platform administrator. Sign in with the credentials you were given.
              </p>
            )}

            {authPanel === "login" || !allowOpenRegistration ? (
              <div className="space-y-4 rounded-2xl border border-crm-border bg-white p-6 shadow-xl shadow-black/50">
                <div>
                  <h2 className="text-xl font-bold text-zinc-900">Welcome back</h2>
                  <p className="mt-1 text-sm text-zinc-600">Sign in with email and password, or with a code sent to your phone.</p>
                </div>
                <div className="flex rounded-xl border border-zinc-200 bg-zinc-50 p-1">
                  <button
                    type="button"
                    className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
                      loginSubtab === "email" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
                    }`}
                    onClick={() => {
                      setLoginSubtab("email");
                      setOtpIssuedForE164(null);
                      setLoginOtp("");
                    }}
                  >
                    Email & password
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
                      loginSubtab === "phone" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
                    }`}
                    onClick={() => setLoginSubtab("phone")}
                  >
                    Phone & SMS code
                  </button>
                </div>

                {loginSubtab === "email" ? (
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Email</label>
                      <input
                        className={INPUT_AUTH_LIGHT}
                        placeholder="you@company.com"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Password</label>
                      <input
                        className={INPUT_AUTH_LIGHT}
                        type="password"
                        placeholder="Your password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <button
                      className="w-full rounded-xl bg-black py-3 text-sm font-bold text-crm-accent transition hover:bg-zinc-900"
                      type="submit"
                    >
                      Sign in
                    </button>
                    <InlineFeedbackText surface="light" feedback={inlineFeedback.authLogin} />
                  </form>
                ) : (
                  <div className="space-y-4">
                    <form onSubmit={handlePhoneSendOtp} className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Phone (E.164)</label>
                        <input
                          className={INPUT_AUTH_LIGHT}
                          placeholder="+919876543210 or 9876543210"
                          autoComplete="tel"
                          inputMode="tel"
                          value={loginPhone}
                          onChange={(e) => setLoginPhone(e.target.value)}
                        />
                        <p className="text-[11px] text-zinc-500">
                          Indian mobiles: you can enter 10 digits without + and we add +91. Otherwise use full E.164.
                        </p>
                      </div>
                      <button
                        className="w-full rounded-xl border border-zinc-300 bg-white py-3 text-sm font-bold text-zinc-900 transition hover:bg-zinc-50"
                        type="submit"
                      >
                        Send 6-digit code
                      </button>
                    </form>
                    <form onSubmit={handlePhoneVerifyOtp} className="space-y-4 border-t border-zinc-100 pt-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Code from SMS</label>
                        <input
                          className={INPUT_AUTH_LIGHT}
                          placeholder="000000"
                          autoComplete="one-time-code"
                          inputMode="numeric"
                          maxLength={8}
                          value={loginOtp}
                          onChange={(e) => setLoginOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        />
                      </div>
                      <button
                        className="w-full rounded-xl bg-black py-3 text-sm font-bold text-crm-accent transition hover:bg-zinc-900 disabled:opacity-50"
                        type="submit"
                        disabled={
                          !otpIssuedForE164 ||
                          !phoneLoginE164Normalized ||
                          phoneLoginE164Normalized !== otpIssuedForE164
                        }
                        title={otpIssuedForE164 ? undefined : "Send a code first"}
                      >
                        Verify and sign in
                      </button>
                      <InlineFeedbackText surface="light" feedback={inlineFeedback.authPhoneLogin} />
                    </form>
                  </div>
                )}
              </div>
            ) : (
              <form
                onSubmit={handleRegister}
                className="space-y-4 rounded-2xl border-2 border-crm-accent/40 bg-zinc-900 p-6 shadow-xl shadow-crm-accent/10"
              >
                <div>
                  <h2 className="text-xl font-bold text-white">Create workspace</h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    One account per organization. You’ll sign in with this email after registration.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-crm-accent">Email</label>
                  <input
                    className={INPUT_CLASS}
                    placeholder="you@company.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-crm-accent">Password</label>
                  <input
                    className={INPUT_CLASS}
                    type="password"
                    placeholder="At least 8 characters recommended"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className="text-[11px] text-zinc-500">Use a strong password; it protects your WhatsApp data.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-crm-accent">Mobile (optional)</label>
                  <input
                    className={INPUT_CLASS}
                    placeholder="+919876543210 or 9876543210 — optional, for SMS sign-in"
                    autoComplete="tel"
                    inputMode="tel"
                    value={registerPhone}
                    onChange={(e) => setRegisterPhone(e.target.value)}
                  />
                  <p className="text-[11px] text-zinc-500">
                    E.164 or 10-digit Indian mobile; we add +91 when you omit the country code.
                  </p>
                </div>
                {email.includes("@") && (
                  <div className="rounded-xl border border-zinc-600 bg-black/35 px-3 py-3 text-xs leading-relaxed text-zinc-400">
                    <p>
                      <span className="font-semibold text-crm-accent">Workspace name: </span>
                      {tenantName || "—"}
                    </p>
                    <p className="mt-2">
                      <span className="font-semibold text-crm-accent">Unique ID: </span>
                      <code className="rounded bg-zinc-950 px-1.5 py-0.5 text-zinc-300">{tenantSlug || "…"}</code>
                    </p>
                    <p className="mt-2 text-[11px] text-zinc-500">
                      We build these from your email (name + address). The ID must be unique — two workspaces cannot share it.
                      Your login email is always unique per account.
                    </p>
                  </div>
                )}
                <button
                  type="button"
                  className="text-left text-xs font-semibold text-crm-accent underline decoration-crm-accent/50 hover:text-crm-accent-hover"
                  onClick={() => setRegisterCustomizeWorkspace((v) => !v)}
                >
                  {registerCustomizeWorkspace ? "Use automatic workspace from email" : "Customize name & unique ID"}
                </button>
                {registerCustomizeWorkspace && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wide text-crm-accent">Workspace name</label>
                      <input
                        className={INPUT_CLASS}
                        placeholder="e.g. Acme Sales"
                        value={tenantName}
                        onChange={(e) => setTenantName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wide text-crm-accent">Unique workspace ID (slug)</label>
                      <input
                        className={INPUT_CLASS}
                        placeholder="acme-team"
                        value={tenantSlug}
                        onChange={(e) => setTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      />
                      <p className="text-[11px] text-zinc-500">Lowercase letters, numbers, hyphens only.</p>
                    </div>
                  </>
                )}
                <button className="w-full rounded-xl bg-crm-accent py-3 text-sm font-bold text-black transition hover:bg-crm-accent-hover" type="submit">
                  Create workspace
                </button>
                <InlineFeedbackText feedback={inlineFeedback.authRegister} />
              </form>
            )}
          </div>
        ) : (
          <>
            {!isSuperAdmin && connectionHealth?.token_alert && (
              <section className="rounded-2xl border border-rose-500/50 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
                <p className="font-semibold">
                  {connectionHealth.token_alert === "expired"
                    ? "WhatsApp token expired — sends and inbox may fail"
                    : "WhatsApp token needs attention"}
                </p>
                <p className="mt-1 text-xs text-rose-200/90">
                  {connectionHealth.token_alert_message || "Update your access token in WhatsApp Settings."}
                </p>
                <button
                  type="button"
                  className={`${BTN_PRIMARY} mt-3 !min-h-0 py-2 text-xs`}
                  onClick={() => {
                    setActiveTab("settings");
                    router.push("/dashboard/settings");
                  }}
                >
                  Go to WhatsApp Settings
                </button>
              </section>
            )}
            {!isSuperAdmin && (
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                <p className="text-xs text-zinc-500">
                  {statsSnapshotRefreshing && !statsUpdatedAt
                    ? "Loading workspace snapshot…"
                    : statsUpdatedAt
                      ? `Snapshot updated ${statsUpdatedAt.toLocaleString()}`
                      : "Sign in to load workspace metrics"}
                </p>
                <button
                  type="button"
                  className={`${BTN_SECONDARY} !min-h-0 py-1.5 pl-3 pr-3 text-xs`}
                  disabled={!token || statsSnapshotRefreshing}
                  onClick={() => void refreshDashboardSnapshot(true)}
                >
                  {statsSnapshotRefreshing ? (
                    <>
                      <Spinner /> Syncing…
                    </>
                  ) : (
                    "Sync metrics"
                  )}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <div className={`${CARD_CLASS} ${!statsSnapshotLoaded && statsSnapshotRefreshing ? "animate-pulse" : ""}`}>
                  <p className="text-xs font-medium text-zinc-500">Contacts</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">{contacts.length}</p>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-400">CRM records</p>
                </div>
                <div className={`${CARD_CLASS} ${!statsSnapshotLoaded && statsSnapshotRefreshing ? "animate-pulse" : ""}`}>
                  <p className="text-xs font-medium text-zinc-500">Open conversations</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">{conversations.length}</p>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-400">Inbox threads</p>
                </div>
                <div className={`${CARD_CLASS} ${!statsSnapshotLoaded && statsSnapshotRefreshing ? "animate-pulse" : ""}`}>
                  <p className="text-xs font-medium text-zinc-500">Templates</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">{templateItems.length}</p>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-400">
                    {approvedTemplateCount} approved
                  </p>
                </div>
                <div className={`${CARD_CLASS} ${!statsSnapshotLoaded && statsSnapshotRefreshing ? "animate-pulse" : ""}`}>
                  <p className="text-xs font-medium text-zinc-500">Running campaigns</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">{campaignStats.running}</p>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-400">Active broadcasts</p>
                </div>
                <div className={`${CARD_CLASS} ${!statsSnapshotLoaded && statsSnapshotRefreshing ? "animate-pulse" : ""}`}>
                  <p className="text-xs font-medium text-zinc-500">Recipients sent</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{campaignStats.sent}</p>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-400">Across all campaigns</p>
                </div>
                <div className={`${CARD_CLASS} ${!statsSnapshotLoaded && statsSnapshotRefreshing ? "animate-pulse" : ""}`}>
                  <p className="text-xs font-medium text-zinc-500">Recipients failed</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-rose-700">{campaignStats.failed}</p>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-400">Needs attention</p>
                </div>
              </div>
            </section>
            )}

            <section className="grid gap-4 lg:grid-cols-[240px,1fr]">
              <aside className={`${CARD_CLASS} h-fit space-y-2 lg:sticky lg:top-6`}>
                {isSuperAdmin ? (
                  <>
                    <p className="px-2 text-xs font-semibold uppercase tracking-wide text-crm-accent/80">Platform</p>
                    <button
                      className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                        activeTab === "platform"
                          ? "bg-crm-accent text-black shadow-md shadow-crm-accent/20"
                          : "text-zinc-300 hover:bg-zinc-800/80 hover:text-white"
                      }`}
                      onClick={() => {
                        setActiveTab("platform");
                        router.push("/dashboard/platform");
                      }}
                    >
                      <div>Agent accounts</div>
                      <div className={`text-xs ${activeTab === "platform" ? "text-black/70" : "text-zinc-500"}`}>
                        Create & monitor
                      </div>
                    </button>
                  </>
                ) : agentNeedsSetup ? (
                  <>
                    <p className="px-2 text-xs font-semibold uppercase tracking-wide text-amber-400/90">Setup required</p>
                    <button
                      className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                        activeTab === "settings"
                          ? "bg-crm-accent text-black shadow-md shadow-crm-accent/20"
                          : "text-zinc-300 hover:bg-zinc-800/80 hover:text-white"
                      }`}
                      onClick={() => {
                        setActiveTab("settings");
                        router.push("/dashboard/settings");
                      }}
                    >
                      <div>WhatsApp Settings</div>
                      <div className={`text-xs ${activeTab === "settings" ? "text-black/70" : "text-zinc-500"}`}>
                        Connect Meta to activate
                      </div>
                    </button>
                  </>
                ) : (
                  <>
                    <p className="px-2 text-xs font-semibold uppercase tracking-wide text-crm-accent/80">Workspace</p>
                    {[
                      ["contacts", "Contacts", "CRM"],
                      ["campaigns", "Campaigns", "Broadcast"],
                      ["templates", "Templates", "Meta"],
                      ["inbox", "Inbox", "Live Chat"]
                    ].map(([key, label, hint]) => (
                      <button
                        key={key}
                        className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                          activeTab === key
                            ? "bg-crm-accent text-black shadow-md shadow-crm-accent/20"
                            : "text-zinc-300 hover:bg-zinc-800/80 hover:text-white"
                        }`}
                        onClick={() => {
                          const next = key as DashboardSection;
                          setActiveTab(next);
                          router.push(`/dashboard/${next}`);
                        }}
                      >
                        <div>{label}</div>
                        <div className={`text-xs ${activeTab === key ? "text-black/70" : "text-zinc-500"}`}>{hint}</div>
                      </button>
                    ))}
                    <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-crm-accent/80">Admin</p>
                    {[
                      ["settings", "WhatsApp Settings", "Connections"],
                      ["analytics", "Analytics", "Reports"],
                      ["automations", "Automations", "Flows"],
                      ["integrations", "Integrations", "External Apps"]
                    ].map(([key, label, hint]) => (
                      <button
                        key={key}
                        className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                          activeTab === key
                            ? "bg-crm-accent text-black shadow-md shadow-crm-accent/20"
                            : "text-zinc-300 hover:bg-zinc-800/80 hover:text-white"
                        }`}
                        onClick={() => {
                          const next = key as DashboardSection;
                          setActiveTab(next);
                          router.push(`/dashboard/${next}`);
                        }}
                      >
                        <div>{label}</div>
                        <div className={`text-xs ${activeTab === key ? "text-black/70" : "text-zinc-500"}`}>{hint}</div>
                      </button>
                    ))}
                  </>
                )}
              </aside>

              <div className="space-y-4">
            <section className={`${CARD_CLASS} flex flex-wrap items-center justify-between gap-3`}>
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">{sectionMeta[activeTab].title}</h2>
                <p className="text-sm text-zinc-500">{sectionMeta[activeTab].subtitle}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="hidden text-xs text-zinc-400 sm:inline">
                    {statsUpdatedAt ? `Data as of ${statsUpdatedAt.toLocaleTimeString()}` : ""}
                  </span>
                  {!isSuperAdmin && (
                    <button
                      type="button"
                      className={`${BTN_SECONDARY} !min-h-0 py-2 pl-3 pr-3 text-xs`}
                      disabled={!token || statsSnapshotRefreshing}
                      onClick={() => void refreshDashboardSnapshot(true)}
                    >
                      {statsSnapshotRefreshing ? (
                        <>
                          <Spinner className="h-3.5 w-3.5" /> Refreshing…
                        </>
                      ) : (
                        "Refresh workspace data"
                      )}
                    </button>
                  )}
                </div>
                <InlineFeedbackText feedback={inlineFeedback.sectionRefresh} className="text-right" />
              </div>
            </section>
            {!isSuperAdmin && (agentNeedsSetup || waConnections.length === 0) && (
              <section className="rounded-2xl border border-amber-500/40 bg-amber-950/30 p-4 space-y-3">
                <h3 className="text-base font-semibold text-amber-100">
                  {agentNeedsSetup ? "Activate your workspace" : "Get started — WhatsApp CRM setup"}
                </h3>
                {agentNeedsSetup ? (
                  <p className="text-sm text-amber-100/90">
                    Your account was created by the platform admin. Add your Meta WhatsApp credentials below (Phone Number ID,
                    WABA ID, access token, verify token, app secret). When the connection is healthy, your full CRM unlocks
                    automatically.
                  </p>
                ) : (
                  <ol className="list-decimal list-inside space-y-1 text-sm text-amber-100/90">
                    <li>
                      Open <strong>WhatsApp Settings</strong> and save Phone Number ID, WABA ID, access token, verify token, and app secret.
                    </li>
                    <li>
                      In <strong>Templates</strong>, sync from Meta and confirm templates show as <strong>APPROVED</strong>.
                    </li>
                    <li>Send a template test to your phone from Settings.</li>
                    <li>Add contacts, then create a campaign or use <strong>Integrations</strong> for an external CRM.</li>
                    <li>For inbound inbox: set Meta webhook to your public API URL (see runbook in repo docs).</li>
                  </ol>
                )}
                <button
                  type="button"
                  className={`${BTN_PRIMARY_BLUE} !min-h-0 py-2 text-sm`}
                  onClick={() => {
                    setActiveTab("settings");
                    router.push("/dashboard/settings");
                  }}
                >
                  Go to WhatsApp Settings
                </button>
              </section>
            )}
            {activeTab === "contacts" && (
              <>
                <section className={`${CARD_CLASS} space-y-4`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-zinc-100">Browse by tag</h2>
                      <p className="text-sm text-zinc-400">Tap a tag to filter the list. Numbers in brackets are contact counts.</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-xl border border-zinc-500 px-3 py-2 text-sm hover:bg-zinc-800/50"
                      onClick={() => void refreshContactList()}
                    >
                      Refresh contacts
                    </button>
                  </div>
                  <form onSubmit={createTag} className="flex flex-wrap gap-2">
                    <input className={`${INPUT_CLASS} max-w-xs`} placeholder="New tag (e.g. Class 6)" value={tagName} onChange={(e) => setTagName(e.target.value)} />
                    <button className="rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700" type="submit">
                      Add tag
                    </button>
                    <InlineFeedbackText feedback={inlineFeedback.tagCreate} />
                  </form>
                  <TagChipPicker
                    tags={tags}
                    selectedIds={activeListTagId ? [activeListTagId] : []}
                    onChange={(ids) => setActiveListTagId(ids[0] ?? null)}
                    counts={tagContactCounts}
                    allowMultiple={false}
                    showAllOption
                    allSelected={!activeListTagId}
                    onSelectAll={() => setActiveListTagId(null)}
                    emptyLabel="No tags yet — create Class 6, Class 5 A, etc. above."
                  />
                </section>
                <section className="grid gap-4 lg:grid-cols-2">
                  <div className={`${CARD_CLASS} space-y-3`}>
                    <h2 className="text-base font-semibold text-zinc-100">Add one contact</h2>
                    <form onSubmit={createContact} className="space-y-2">
                      <input className={INPUT_CLASS} placeholder="Name (optional)" value={contactName} onChange={(e) => setContactName(e.target.value)} />
                      <input className={INPUT_CLASS} placeholder="9999999999 (auto +91)" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                      <input className={INPUT_CLASS} placeholder="Attributes (city:Mumbai,source:ads)" value={attributesInput} onChange={(e) => setAttributesInput(e.target.value)} />
                      <div>
                        <p className="mb-2 text-xs font-medium text-zinc-400">Assign tags (tap to select)</p>
                        <TagChipPicker tags={tags} selectedIds={selectedTagIds} onChange={setSelectedTagIds} counts={tagContactCounts} />
                      </div>
                      <button className={BTN_PRIMARY_BLUE} type="submit" disabled={creatingContact}>
                        {creatingContact ? (
                          <>
                            <Spinner /> Saving…
                          </>
                        ) : (
                          "Create Contact"
                        )}
                      </button>
                      <InlineFeedbackText feedback={inlineFeedback.contactCreate} />
                    </form>
                  </div>
                </section>

                <section className={`${CARD_CLASS} space-y-3`}>
                  <h2 className="text-base font-semibold text-zinc-100">Bulk import (CSV)</h2>
                  <p className="text-xs text-zinc-500">
                    Upload a list and apply one or more tags to every imported row — e.g. Class 6, Class 5 A.
                  </p>
                  <form onSubmit={importContactsCsv} className="space-y-2">
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className={INPUT_CLASS}
                      onChange={(e) => setContactImportCsvFile(e.target.files?.[0] ?? null)}
                    />
                    {contactImportCsvFile && (
                      <p className="text-xs text-zinc-400">
                        File: <span className="text-zinc-200">{contactImportCsvFile.name}</span>
                        {contactImportRowCount > 0 ? ` · ${contactImportRowCount} rows` : " · counting rows…"}
                      </p>
                    )}
                    <div>
                      <p className="mb-2 text-xs font-medium text-zinc-400">Tag for this import (tap to select)</p>
                      <TagChipPicker tags={tags} selectedIds={contactImportTagIds} onChange={setContactImportTagIds} counts={tagContactCounts} />
                    </div>
                    <div className="rounded-lg border border-zinc-600 bg-zinc-900/60 p-3 text-xs text-zinc-400">
                      <p className="font-medium text-zinc-300">Example CSV</p>
                      <pre className="mt-1 overflow-x-auto rounded bg-black/50 p-2 font-mono text-[11px] text-emerald-200/90">{`phone_e164,name,roll_no
919876543210,Rahul,601
918109462946,Priya,602`}</pre>
                      <p className="mt-2">
                        Phone column: <code className="text-zinc-300">phone_e164</code>, <code className="text-zinc-300">phone</code>, or{" "}
                        <code className="text-zinc-300">mobile</code>. Extra columns are saved as contact attributes.
                      </p>
                    </div>
                    <button className={BTN_PRIMARY_BLUE} type="submit" disabled={importingContacts}>
                      {importingContacts ? (
                        <>
                          <Spinner /> Importing…
                        </>
                      ) : (
                        "Import contacts"
                      )}
                    </button>
                    <InlineFeedbackText feedback={inlineFeedback.contactImport} />
                  </form>
                </section>

                <section className={`${CARD_CLASS} space-y-3`}>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-crm-accent/25 bg-crm-accent/10 px-4 py-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-crm-accent">Showing</p>
                      <p className="text-lg font-semibold text-zinc-100">{activeListTagName ?? "All contacts"}</p>
                    </div>
                    <p className="text-2xl font-bold tabular-nums text-crm-accent">
                      {listFilterLoading ? "…" : contacts.length}
                      <span className="ml-2 text-sm font-normal text-zinc-400">contacts</span>
                    </p>
                  </div>
                  <input
                    className={INPUT_CLASS}
                    placeholder="Search name or phone in this view…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <InlineFeedbackText feedback={inlineFeedback.contactList} />

                  <div className="overflow-x-auto rounded-xl border border-zinc-600">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-zinc-800/50 text-zinc-400">
                        <tr>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Phone</th>
                          <th className="px-3 py-2">Messaging</th>
                          <th className="px-3 py-2">Tags</th>
                          <th className="px-3 py-2">Attributes</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {listFilterLoading ? (
                          <tr>
                            <td className="px-3 py-8 text-center text-zinc-500" colSpan={6}>
                              Loading contacts…
                            </td>
                          </tr>
                        ) : (
                          contacts.map((contact) => (
                          <tr key={contact.id} className="border-t border-zinc-700">
                            <td className="px-3 py-2">{contact.name || "-"}</td>
                            <td className="px-3 py-2">{contact.phone_e164}</td>
                            <td className="px-3 py-2">
                              <span className={windowBadgeClass(contact.messaging_window)} title={contact.messaging_window?.session_hint}>
                                {windowBadgeLabel(contact.messaging_window)}
                              </span>
                              {contact.messaging_window?.is_open && contact.messaging_window.seconds_remaining != null && (
                                <p className="mt-1 text-[10px] text-zinc-500">
                                  {formatWindowRemaining(contact.messaging_window.seconds_remaining)}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2">{contact.tags.map((tag) => tag.name).join(", ") || "-"}</td>
                            <td className="px-3 py-2">{Object.entries(contact.custom_attributes || {}).map(([k, v]) => `${k}:${String(v)}`).join(", ") || "-"}</td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className={`${BTN_ROW} border border-zinc-600 bg-white text-zinc-200 hover:bg-zinc-800/50`}
                                  onClick={() => startEdit(contact)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className={`${BTN_ROW} border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100`}
                                  onClick={() => {
                                    setQuickSendContact(contact);
                                    setQuickTemplateKey("");
                                  }}
                                >
                                  Template
                                </button>
                                <button
                                  type="button"
                                  className={`${BTN_ROW} border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100`}
                                  onClick={() => deleteContact(contact.id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                          ))
                        )}
                        {!listFilterLoading && contacts.length === 0 && (
                          <tr>
                            <td className="px-3 py-8 text-center text-zinc-500" colSpan={6}>
                              {activeListTagName
                                ? `No contacts in “${activeListTagName}” yet. Import a CSV or add students with this tag.`
                                : "No contacts yet. Add one above or bulk import a CSV."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                {quickSendContact && (
                  <section className={`${CARD_CLASS} space-y-3 border border-emerald-100`}>
                    <h2 className="text-base font-semibold text-zinc-100">Send template to contact</h2>
                    <p className="text-sm text-zinc-400">
                      Recipient: <span className="font-medium text-zinc-100">{quickSendContact.name || "Unnamed"}</span> — {quickSendContact.phone_e164}
                    </p>
                    {templateItems.length === 0 ? (
                      <p className="text-sm text-amber-800">
                        No templates in library. Sync templates from the Settings or Templates tab, then return here.
                      </p>
                    ) : (
                      <>
                        <select
                          className={INPUT_CLASS}
                          value={quickTemplateKey}
                          onChange={(e) => setQuickTemplateKey(e.target.value)}
                        >
                          <option value="">Select synced template</option>
                          {templateItems.map((item) => (
                            <option key={`${item.name}:${item.language}`} value={`${item.name}__${item.language}`}>
                              {item.name} ({item.language})
                            </option>
                          ))}
                        </select>
                        {(() => {
                          const sel = templateItems.find((it) => `${it.name}__${it.language}` === quickTemplateKey);
                          if (!sel?.preview_text?.trim()) return null;
                          return (
                            <div className="rounded-lg border border-zinc-600 bg-zinc-800/50 p-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Message preview</p>
                              <p className="whitespace-pre-wrap text-sm text-zinc-200">{sel.preview_text.trim()}</p>
                            </div>
                          );
                        })()}
                        <TemplateVariableFields
                          templateKey={quickTemplateKey}
                          templateItems={templateItems}
                          values={quickTemplateVars}
                          onChange={(key, value) => setQuickTemplateVars((prev) => ({ ...prev, [key]: value }))}
                          contactName={quickSendContact.name}
                        />
                        <p className="text-xs text-zinc-500">Approved template required. Fill every variable before sending.</p>
                      </>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={BTN_SUCCESS}
                        disabled={templateItems.length === 0 || !quickTemplateKey || sendingQuickTemplate}
                        onClick={() => void submitQuickTemplateToContact()}
                      >
                        {sendingQuickTemplate ? (
                          <>
                            <Spinner /> Sending…
                          </>
                        ) : (
                          "Send template"
                        )}
                      </button>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={sendingQuickTemplate}
                        onClick={() => {
                          setQuickSendContact(null);
                          setQuickTemplateKey("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    <InlineFeedbackText feedback={inlineFeedback.contactQuickSend} />
                  </section>
                )}

                {editingContactId && (
                  <section className={`${CARD_CLASS} space-y-3`}>
                    <h2 className="text-base font-semibold text-zinc-100">Edit Contact</h2>
                    <form onSubmit={updateContact} className="grid gap-2 md:grid-cols-2">
                      <input className={INPUT_CLASS} placeholder="Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                      <input className={INPUT_CLASS} placeholder="9999999999 (auto +91)" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                      <input className={`${INPUT_CLASS} md:col-span-2`} placeholder="Attributes (city:Mumbai,source:ads)" value={editAttributesInput} onChange={(e) => setEditAttributesInput(e.target.value)} />
                      <div className="md:col-span-2">
                        <p className="mb-2 text-xs font-medium text-zinc-400">Tags (tap to select)</p>
                        <TagChipPicker tags={tags} selectedIds={editTagIds} onChange={setEditTagIds} counts={tagContactCounts} />
                      </div>
                      <div className="flex gap-2 md:col-span-2">
                        <button className="rounded-xl bg-crm-accent px-4 py-2 text-sm font-bold text-black hover:bg-crm-accent-hover" type="submit">
                          Save
                        </button>
                        <button className="rounded-xl border border-zinc-500 px-4 py-2 text-sm hover:bg-zinc-800/50" type="button" onClick={clearEditForm}>
                          Cancel
                        </button>
                      </div>
                      <InlineFeedbackText className="md:col-span-2" feedback={inlineFeedback.contactEdit} />
                    </form>
                  </section>
                )}
              </>
            )}

            {activeTab === "campaigns" && (
              <section className="grid gap-4 xl:grid-cols-2">
                <div className={`${CARD_CLASS} space-y-4`}>
                  <div>
                    <h2 className="text-base font-semibold text-zinc-100">Launch campaign</h2>
                    <p className="mt-1 text-xs text-zinc-500">
                      Contact broadcast, CSV upload, or API-triggered sends (AiSensy / WATI style).
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        ["contacts", "Contact broadcast", "Pick CRM contacts"],
                        ["csv", "CSV broadcast", "Upload phone list"],
                        ["api", "API campaign", "External triggers"],
                      ] as const
                    ).map(([type, title, hint]) => (
                      <button
                        key={type}
                        type="button"
                        className={`rounded-xl border p-3 text-left text-sm transition ${
                          campaignLaunchType === type
                            ? "border-crm-accent bg-crm-accent/15 text-zinc-100"
                            : "border-zinc-600 text-zinc-400 hover:border-zinc-500"
                        }`}
                        onClick={() => setCampaignLaunchType(type)}
                      >
                        <p className="font-semibold">{title}</p>
                        <p className="mt-1 text-[11px] opacity-80">{hint}</p>
                      </button>
                    ))}
                  </div>
                  <form onSubmit={createCampaign} className="space-y-3">
                    <input className={INPUT_CLASS} placeholder="Campaign name" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
                    {approvedTemplates.length === 0 ? (
                      <p className="text-sm text-amber-200/90">
                        No approved templates loaded. Use Load Templates, then pick an approved template.
                      </p>
                    ) : (
                      <>
                        <select
                          className={INPUT_CLASS}
                          value={waTemplateName && waTemplateLanguage ? `${waTemplateName}__${waTemplateLanguage}` : ""}
                          onChange={(e) => {
                            const selected = approvedTemplates.find((item) => `${item.name}__${item.language}` === e.target.value);
                            if (selected) {
                              setWaTemplateName(selected.name);
                              setWaTemplateLanguage(selected.language);
                            } else {
                              setWaTemplateName("");
                              setWaTemplateLanguage("en_US");
                            }
                          }}
                        >
                          <option value="">Select approved template</option>
                          {approvedTemplates.map((item) => (
                            <option key={`${item.name}:${item.language}`} value={`${item.name}__${item.language}`}>
                              {item.name} ({item.language})
                            </option>
                          ))}
                        </select>
                        {(() => {
                          const sel = approvedTemplates.find((it) => it.name === waTemplateName && it.language === waTemplateLanguage);
                          if (!sel?.preview_text?.trim()) return null;
                          return (
                            <div className="rounded-lg border border-zinc-600 bg-zinc-800/50 p-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Template preview</p>
                              <p className="whitespace-pre-wrap text-sm text-zinc-200">{sel.preview_text.trim()}</p>
                            </div>
                          );
                        })()}
                        <CampaignCostPanel
                          estimate={launchCostEstimate}
                          perTrigger={campaignLaunchType === "api"}
                        />
                        {waTemplateName && waTemplateLanguage && (
                          <TemplateVariableFields
                            templateKey={`${waTemplateName}__${waTemplateLanguage}`}
                            templateItems={approvedTemplates}
                            values={campaignTemplateVars}
                            onChange={(key, value) =>
                              setCampaignTemplateVars((prev) => ({ ...prev, [key]: value }))
                            }
                            broadcastHint={campaignLaunchType !== "api"}
                          />
                        )}
                      </>
                    )}
                    {campaignLaunchType === "contacts" && (
                      <>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {(
                            [
                              ["tags", "By tags", "Everyone with selected tag(s)"],
                              ["manual", "Pick contacts", "Choose individuals from the list"],
                            ] as const
                          ).map(([mode, title, hint]) => (
                            <button
                              key={mode}
                              type="button"
                              className={`rounded-xl border p-3 text-left text-sm transition ${
                                campaignTargetMode === mode
                                  ? "border-crm-accent bg-crm-accent/15 text-zinc-100"
                                  : "border-zinc-600 text-zinc-400 hover:border-zinc-500"
                              }`}
                              onClick={() => setCampaignTargetMode(mode)}
                            >
                              <p className="font-semibold">{title}</p>
                              <p className="mt-1 text-[11px] opacity-80">{hint}</p>
                            </button>
                          ))}
                        </div>
                        {campaignTargetMode === "tags" ? (
                          <>
                            <p className="text-xs font-medium text-zinc-400">Select audience tag(s)</p>
                            <TagChipPicker
                              tags={tags}
                              selectedIds={campaignTagIds}
                              onChange={setCampaignTagIds}
                              counts={tagContactCounts}
                              emptyLabel="Create tags on the Contacts tab first (e.g. Class 6)."
                            />
                            <ContactPreviewPanel
                              title={
                                campaignTagIds.length === 0
                                  ? "Recipients preview"
                                  : `Recipients · ${campaignTagIds.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean).join(", ")}`
                              }
                              contacts={campaignTagPreviewContacts}
                              loading={campaignTagPreviewLoading}
                              emptyHint={
                                campaignTagIds.length === 0
                                  ? "Select one or more tags to see who will receive this campaign."
                                  : "No contacts have these tags yet. Import students on the Contacts tab."
                              }
                            />
                          </>
                        ) : (
                          <>
                        <div className="rounded-xl border border-zinc-600 bg-black/30">
                          <label className="flex cursor-pointer items-center gap-3 border-b border-zinc-700 px-3 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800/40">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-zinc-500 accent-crm-accent"
                              checked={allCampaignContactsSelected}
                              onChange={toggleAllCampaignContacts}
                              disabled={contacts.length === 0}
                            />
                            <span>
                              Select all
                              <span className="ml-1 font-normal text-zinc-500">
                                ({campaignContactIds.length} of {contacts.length} selected)
                              </span>
                            </span>
                          </label>
                          <div className="max-h-44 overflow-y-auto divide-y divide-zinc-800">
                            {contacts.length === 0 ? (
                              <p className="px-3 py-4 text-sm text-zinc-500">No contacts loaded. Open Contacts tab or refresh.</p>
                            ) : (
                              contacts.map((contact) => {
                                const checked = campaignContactIds.includes(contact.id);
                                return (
                                  <label
                                    key={contact.id}
                                    className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-zinc-800/30 ${
                                      checked ? "bg-crm-accent/10" : ""
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-500 accent-crm-accent"
                                      checked={checked}
                                      onChange={() => toggleCampaignContact(contact.id)}
                                    />
                                    <span>
                                      <span className="font-medium text-zinc-100">{contact.name || "Unnamed"}</span>
                                      <span className="block text-xs text-zinc-500">{contact.phone_e164}</span>
                                    </span>
                                  </label>
                                );
                              })
                            )}
                          </div>
                        </div>
                        <p className="text-[11px] text-zinc-500">Tick one or many recipients, or use Select all. Body variables use each contact&apos;s name.</p>
                          </>
                        )}
                      </>
                    )}
                    {campaignLaunchType === "csv" && (
                      <>
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          className={INPUT_CLASS}
                          onChange={(e) => setCampaignCsvFile(e.target.files?.[0] ?? null)}
                        />
                        {campaignCsvFile && (
                          <p className="text-xs text-zinc-400">
                            File: <span className="text-zinc-200">{campaignCsvFile.name}</span>
                            {csvRowCount > 0 ? ` · ${csvRowCount} rows` : " · counting rows…"}
                          </p>
                        )}
                        <div className="rounded-lg border border-zinc-600 bg-zinc-900/60 p-3 text-xs text-zinc-400">
                          <p className="font-semibold text-zinc-300">How CSV broadcast works</p>
                          <ol className="mt-2 list-inside list-decimal space-y-1">
                            <li>Create the campaign with name + approved template.</li>
                            <li>Upload a UTF-8 CSV — we import phones and add them as recipients.</li>
                            <li>New numbers become contacts; duplicates in the same campaign are skipped.</li>
                            <li>Click <strong className="text-zinc-200">Start broadcast</strong> in the list on the right.</li>
                          </ol>
                          <p className="mt-3 font-medium text-zinc-300">Example CSV</p>
                          <pre className="mt-1 overflow-x-auto rounded bg-black/50 p-2 font-mono text-[11px] text-emerald-200/90">{`phone_e164,name,var1
919876543210,Rohit,Hi Rohit
918109462946,Neha,Hi Neha`}</pre>
                          <p className="mt-2">
                            Phone column: <code className="text-zinc-300">phone_e164</code>, <code className="text-zinc-300">phone</code>, or{" "}
                            <code className="text-zinc-300">mobile</code>. Extra columns map to template variables (
                            <code className="text-zinc-300">var1</code>, <code className="text-zinc-300">var2</code>, or named placeholders).
                          </p>
                        </div>
                      </>
                    )}
                    {campaignLaunchType === "api" && (
                      <div className="space-y-2">
                        <div className="rounded-lg border border-indigo-800/50 bg-indigo-950/30 p-3 text-xs text-indigo-100">
                          <p className="font-semibold">AiSensy-style API campaign</p>
                          <ul className="mt-2 list-inside list-disc space-y-1">
                            <li>Fixed template per automation (cart abandon, payment receipt).</li>
                            <li>Go Live, then POST /integrations/campaigns/&#123;id&#125;/trigger</li>
                            <li>Each trigger ≈ one billable template message.</li>
                          </ul>
                        </div>
                        <p className="text-[11px] text-zinc-500">Integration key: Admin → Integrations.</p>
                      </div>
                    )}
                    <button
                      className="rounded-xl bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-60"
                      type="submit"
                      disabled={approvedTemplates.length === 0}
                    >
                      {campaignLaunchType === "api" ? "Create API campaign" : "Create campaign"}
                    </button>
                    <InlineFeedbackText feedback={inlineFeedback.campaignCreate} />
                  </form>
                </div>

                <div className={`${CARD_CLASS} space-y-3`}>
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-zinc-100">Campaigns</h2>
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex gap-2">
                        <button
                          className="rounded-xl border border-zinc-500 px-3 py-2 text-sm hover:bg-zinc-800/50"
                          type="button"
                          onClick={() => loadTemplates("campaignActions")}
                        >
                          Load Templates
                        </button>
                        <button
                          className="rounded-xl border border-zinc-500 px-3 py-2 text-sm hover:bg-zinc-800/50"
                          type="button"
                          onClick={() => loadCampaigns("campaignActions")}
                        >
                          Refresh
                        </button>
                      </div>
                      <InlineFeedbackText feedback={inlineFeedback.campaignActions} />
                    </div>
                  </div>
                  <div className="max-h-96 space-y-2 overflow-auto">
                    {campaigns.map((campaign) => (
                      <div key={campaign.id} className="rounded-xl border border-zinc-600 p-3">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-zinc-100">{campaign.name}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] uppercase text-zinc-400">
                              {campaignTypeLabel(campaign.campaign_type || "contacts")}
                          </span>
                          <span
                            className={`rounded-full px-2 py-1 text-xs ${
                              campaign.status === "running" || campaign.status === "live"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {campaign.status}
                          </span>
                          </div>
                        </div>
                        <p className="mt-2 text-sm text-zinc-400">
                          Template: <span className="font-medium text-zinc-200">{campaign.template_name || "—"}</span>
                          {campaign.template_language ? ` (${campaign.template_language})` : ""}
                        </p>
                        <p className="mt-2 text-xs text-zinc-500">Recipients: {campaign.recipients.length}</p>
                        {campaign.cost_estimate && (
                          <p className="mt-1 text-xs text-emerald-300/90">
                            Approx. Meta cost: {formatMetaInr(campaign.cost_estimate.estimated_total_inr)}
                            {campaign.campaign_type === "api" ? " (per trigger if 1 recipient)" : ""}
                            {campaign.cost_estimate.template_category
                              ? ` · ${campaign.cost_estimate.template_category}`
                              : ""}
                          </p>
                        )}
                        {campaign.recipients.some((r) => r.last_error) && (
                          <div className="mt-2 space-y-1 rounded-lg border border-rose-900/50 bg-rose-950/30 p-2">
                            {campaign.recipients
                              .filter((r) => r.last_error)
                              .slice(0, 5)
                              .map((r) => (
                                <p key={r.id} className="text-xs text-rose-200">
                                  {r.state}: {r.last_error}
                                </p>
                              ))}
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(campaign.campaign_type || "contacts") === "api" ? (
                            <>
                              <button
                                type="button"
                                className="rounded-lg border border-indigo-500 px-3 py-1 text-xs text-indigo-200 hover:bg-indigo-950/50 disabled:opacity-60"
                                onClick={() => goLiveApiCampaign(campaign.id)}
                                disabled={campaign.status === "live"}
                              >
                                {campaign.status === "live" ? "Live" : "Go Live"}
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-zinc-500 px-3 py-1 text-xs hover:bg-zinc-800/50"
                                onClick={() => setSelectedApiCampaignId(campaign.id)}
                              >
                                API docs
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="rounded-lg border border-zinc-500 px-3 py-1 text-xs hover:bg-zinc-800/50 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => startCampaign(campaign.id)}
                              disabled={campaign.status === "running" || campaign.status === "completed"}
                            >
                              {campaign.status === "running" ? "Running" : "Start broadcast"}
                            </button>
                          )}
                        </div>
                        {(selectedApiCampaignId === campaign.id || campaign.status === "live") &&
                          (campaign.campaign_type || "contacts") === "api" && (
                            <ApiCampaignTriggerKit
                              campaignId={campaign.id}
                              campaignStatus={campaign.status}
                              templateName={campaign.template_name}
                              templateLanguage={campaign.template_language}
                              templateItems={templateItems}
                            />
                          )}
                      </div>
                    ))}
                    {campaigns.length === 0 && <p className="text-sm text-zinc-500">No campaigns yet</p>}
                  </div>
                </div>
              </section>
            )}

            {activeTab === "settings" && (
              <>
                <section className={`${CARD_CLASS} space-y-3`}>
                  <h2 className="text-base font-semibold text-zinc-100">Setup checklist</h2>
                  <p className="text-xs text-zinc-500">Complete these steps for a reliable WhatsApp CRM setup.</p>
                  <ul className="space-y-2 text-sm text-zinc-300">
                    <li className="flex items-center gap-2">
                      <span className={waConnectionId && waPhoneNumberId.trim() ? "text-emerald-600" : "text-zinc-400"}>
                        {waConnectionId && waPhoneNumberId.trim() ? "✓" : "○"}
                      </span>
                      Connection saved (phone number id)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={waWabaId.trim() ? "text-emerald-600" : "text-zinc-400"}>{waWabaId.trim() ? "✓" : "○"}</span>
                      WABA ID set (for template sync)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={waVerifyTokenConfigured ? "text-emerald-600" : "text-zinc-400"}>{waVerifyTokenConfigured ? "✓" : "○"}</span>
                      Verify token set (Meta webhook)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={waAppSecretConfigured ? "text-emerald-600" : "text-zinc-400"}>{waAppSecretConfigured ? "✓" : "○"}</span>
                      App secret set (secure inbound webhooks)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={templateItems.length > 0 ? "text-emerald-600" : "text-zinc-400"}>{templateItems.length > 0 ? "✓" : "○"}</span>
                      Templates synced ({templateItems.length} in library)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={typeof profilePhoneE164 === "string" && profilePhoneE164 ? "text-emerald-600" : "text-zinc-400"}>
                        {typeof profilePhoneE164 === "string" && profilePhoneE164 ? "✓" : "○"}
                      </span>
                      SMS sign-in number on your account (add below)
                    </li>
                  </ul>
                </section>

                <section className={`${CARD_CLASS} space-y-3`}>
                  <h2 className="text-base font-semibold text-zinc-100">SMS sign-in (Sent.dm)</h2>
                  <p className="text-xs text-zinc-500">
                    For accounts created before phone login existed: add your mobile here so “Phone & SMS code” works on the login page. Uses the same Sent.dm template as sign-in OTP.
                  </p>
                  <p className="text-sm text-zinc-300">
                    <span className="font-semibold text-crm-accent">Saved on your user: </span>
                    {profilePhoneE164 === undefined ? "Loading…" : profilePhoneE164 || "Not set"}
                  </p>
                  <form onSubmit={handleBindPhoneSendOtp} className="space-y-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-400">Mobile (E.164 or 10-digit IN)</label>
                      <input
                        className={INPUT_CLASS}
                        placeholder="+919876543210 or 9876543210"
                        autoComplete="tel"
                        inputMode="tel"
                        value={bindPhone}
                        onChange={(e) => setBindPhone(e.target.value)}
                      />
                    </div>
                    <button className={BTN_SECONDARY} type="submit">
                      Send verification code
                    </button>
                  </form>
                  <form onSubmit={handleBindPhoneVerifyOtp} className="space-y-2 border-t border-zinc-600/60 pt-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-400">Code from SMS</label>
                      <input
                        className={INPUT_CLASS}
                        placeholder="000000"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={8}
                        value={bindOtp}
                        onChange={(e) => setBindOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      />
                    </div>
                    <button
                      className={BTN_PRIMARY}
                      type="submit"
                      disabled={
                        !bindOtpIssuedForE164 ||
                        !bindPhoneE164Normalized ||
                        bindPhoneE164Normalized !== bindOtpIssuedForE164
                      }
                    >
                      Verify and save number
                    </button>
                    <InlineFeedbackText feedback={inlineFeedback.phoneBindSettings} />
                  </form>
                </section>

                <section className="grid gap-4 lg:grid-cols-2">
                <div className={`${CARD_CLASS} space-y-3`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-zinc-100">Meta WhatsApp Connection</h2>
                      {connectionHealth && (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            connectionHealth.overall === "healthy"
                              ? "bg-emerald-100 text-emerald-800"
                              : connectionHealth.overall === "disconnected"
                                ? "bg-zinc-700 text-zinc-300"
                                : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {connectionHealth.overall === "healthy"
                            ? "Healthy"
                            : connectionHealth.overall === "disconnected"
                              ? "Not connected"
                              : "Needs attention"}
                        </span>
                      )}
                      <button
                        type="button"
                        className="rounded-lg border border-zinc-600 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800/50"
                        onClick={() => loadConnectionHealth()}
                      >
                        Re-check
                      </button>
                    </div>
                    <div className="flex gap-2">
                        <button className="rounded-xl border border-zinc-500 px-3 py-2 text-sm hover:bg-zinc-800/50" type="button" onClick={() => loadWhatsAppConnection("waConnectionForm")}>
                          Load Default
                        </button>
                        <button className="rounded-xl border border-zinc-500 px-3 py-2 text-sm hover:bg-zinc-800/50" type="button" onClick={() => loadWhatsAppConnections("waConnectionForm")}>
                          List All
                        </button>
                    </div>
                  </div>
                  {connectionHealth?.token_alert && (
                    <div
                      className={`rounded-xl border px-3 py-3 text-sm ${
                        connectionHealth.token_alert === "expired"
                          ? "border-rose-500/50 bg-rose-950/50 text-rose-100"
                          : "border-amber-500/40 bg-amber-950/40 text-amber-100"
                      }`}
                    >
                      <p className="font-semibold">
                        {connectionHealth.token_alert === "expired"
                          ? "Meta access token expired"
                          : connectionHealth.token_alert === "missing"
                            ? "Meta access token missing"
                            : "Meta access token problem"}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed opacity-90">
                        {connectionHealth.token_alert_message ||
                          connectionHealth.token_error ||
                          "Paste a fresh long-lived token from Meta and save this connection."}
                      </p>
                    </div>
                  )}
                  {connectionHealth && connectionHealth.overall !== "healthy" && connectionHealth.hints.length > 0 && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
                      {connectionHealth.hints.map((hint) => (
                        <p key={hint} className="leading-relaxed">
                          • {hint}
                        </p>
                      ))}
                    </div>
                  )}
                  <form onSubmit={saveWhatsAppConnection} className="space-y-2">
                    <select
                      className={INPUT_CLASS}
                      value={waConnectionId}
                      onChange={(e) => {
                        setWaConnectionId(e.target.value);
                        applySelectedConnection(e.target.value);
                      }}
                    >
                      <option value="">New connection</option>
                      {waConnections.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label} - {item.phone_number_id} {item.is_default ? "(default)" : ""}
                        </option>
                      ))}
                    </select>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-400">Connection Label</label>
                      <input className={INPUT_CLASS} placeholder="Primary" value={waLabel} onChange={(e) => setWaLabel(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-400">Phone Number ID</label>
                      <input className={INPUT_CLASS} placeholder="Meta phone number id" value={waPhoneNumberId} onChange={(e) => setWaPhoneNumberId(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-400">WABA ID</label>
                      <input className={INPUT_CLASS} placeholder="WhatsApp Business Account ID" value={waWabaId} onChange={(e) => setWaWabaId(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-400">Access Token</label>
                      <input
                        className={INPUT_CLASS}
                        placeholder={waAccessTokenPreview ? "Saved securely. Enter only to rotate token" : "Paste fresh Meta access token"}
                        value={waAccessToken}
                        onChange={(e) => setWaAccessToken(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-400">Verify Token</label>
                      <input
                        className={INPUT_CLASS}
                        placeholder={waVerifyTokenConfigured ? "Saved securely. Enter only to rotate verify token" : "Your custom webhook verify token"}
                        value={waVerifyToken}
                        onChange={(e) => setWaVerifyToken(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-400">App Secret</label>
                      <input
                        className={INPUT_CLASS}
                        placeholder={waAppSecretConfigured ? "Saved securely. Enter only to rotate app secret" : "Meta app secret"}
                        value={waAppSecret}
                        onChange={(e) => setWaAppSecret(e.target.value)}
                      />
                    </div>
                    {waAccessTokenPreview && (
                      <p className="text-xs text-zinc-500">
                        Saved token: {waAccessTokenPreview} {waAppSecretConfigured ? "| App secret configured" : "| App secret not set"}
                      </p>
                    )}
                    <div className="flex gap-4 text-sm text-zinc-300">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={waIsDefault} onChange={(e) => setWaIsDefault(e.target.checked)} />
                        Default
                      </label>
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={waIsActive} onChange={(e) => setWaIsActive(e.target.checked)} />
                        Active
                      </label>
                    </div>
                    <button className={BTN_PRIMARY_BLUE} type="submit" disabled={savingWaConnection}>
                      {savingWaConnection ? (
                        <>
                          <Spinner /> Saving…
                        </>
                      ) : (
                        "Save Connection"
                      )}
                    </button>
                    {waConnectionId && (
                      <button
                        className="ml-2 rounded-xl border border-red-200 px-4 py-2 text-sm text-red-700 hover:bg-red-50"
                        type="button"
                        onClick={deleteSelectedConnection}
                      >
                        Delete Connection
                      </button>
                    )}
                    <InlineFeedbackText feedback={inlineFeedback.waConnectionForm} />
                  </form>
                </div>

                <div className={`${CARD_CLASS} space-y-3`}>
                  <h2 className="text-base font-semibold text-zinc-100">Send Template Test</h2>
                  <form onSubmit={sendTemplateTest} className="space-y-2">
                    <input className={INPUT_CLASS} placeholder="Recipient phone (auto +91)" value={waTestToPhone} onChange={(e) => setWaTestToPhone(e.target.value)} />
                    <select
                      className={INPUT_CLASS}
                      value={waTemplateName ? `${waTemplateName}__${waTemplateLanguage}` : ""}
                      onChange={(e) => {
                        const [name, language] = e.target.value.split("__");
                        setWaTemplateName(name || "");
                        setWaTemplateLanguage(language || "en_US");
                      }}
                    >
                      <option value="">Select synced template</option>
                      {templateItems.map((item) => (
                        <option key={`${item.name}:${item.language}`} value={`${item.name}__${item.language}`}>
                          {item.name} ({item.language})
                        </option>
                      ))}
                    </select>
                    {(() => {
                      const sel = templateItems.find((it) => it.name === waTemplateName && it.language === waTemplateLanguage);
                      if (!sel?.preview_text?.trim()) return null;
                      return (
                        <div className="rounded-lg border border-zinc-600 bg-zinc-800/50 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Message preview</p>
                          <p className="whitespace-pre-wrap text-sm text-zinc-200">{sel.preview_text.trim()}</p>
                        </div>
                      );
                    })()}
                    <p className="text-xs text-zinc-500">Selected language: {waTemplateLanguage || "en_US"}</p>
                    <button className={BTN_SUCCESS} type="submit" disabled={sendingTemplateTest}>
                      {sendingTemplateTest ? (
                        <>
                          <Spinner /> Sending…
                        </>
                      ) : (
                        "Send Test Template"
                      )}
                    </button>
                    <InlineFeedbackText feedback={inlineFeedback.waTemplateTest} />
                  </form>
                  <p className="text-xs text-zinc-500">
                    Test requires an approved template in Meta and recipient allowed in your WhatsApp setup.
                  </p>
                </div>

              </section>
              </>
            )}

            {activeTab === "templates" && (
              <section className="space-y-4">
                <div className={`${CARD_CLASS} space-y-3`}>
                  <h2 className="text-base font-semibold text-zinc-100">Create template in Meta</h2>
                  <p className="text-xs text-zinc-500">
                    Sends a TEXT header/body/footer template for approval using your logged-in account's default WhatsApp connection.
                    Numbered placeholders like{" "}
                    <code className="rounded bg-zinc-800 px-1">{"{{1}}"}</code> are converted to named variables for Meta (
                    <code className="rounded bg-zinc-800 px-1">{"{{your_label}}"}</code>
                    ). When you later{" "}
                    <a
                      className="font-medium text-blue-600 underline"
                      href="https://developers.facebook.com/documentation/business-messaging/whatsapp/message-templates/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      send a template message
                    </a>
                    , the Cloud API uses{" "}
                    <code className="rounded bg-zinc-800 px-1">template.components[].parameters[]</code> with{" "}
                    <code className="rounded bg-zinc-800 px-1">parameter_name</code> +{" "}
                    <code className="rounded bg-zinc-800 px-1">text</code> for each variable (see Meta&apos;s named-parameter send
                    examples). Use the variable fields in Inbox, Contacts, or Campaigns when sending templates with placeholders.
                  </p>
                  <form onSubmit={createTemplateInMeta} className="space-y-2">
                    {!wabaConnections.length && (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        No active default connection with WABA ID is configured in WhatsApp Settings.
                      </p>
                    )}
                    <input
                      className={INPUT_CLASS}
                      placeholder="Template name (e.g. order_update)"
                      value={createTplName}
                      onChange={(e) => setCreateTplName(e.target.value)}
                      autoComplete="off"
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-zinc-400">Language</label>
                        <select
                          className={INPUT_CLASS}
                          value={createTplLanguageSelect}
                          onChange={(e) => setCreateTplLanguageSelect(e.target.value)}
                        >
                          {WHATSAPP_TEMPLATE_LANGUAGES.map((l) => (
                            <option key={l.code} value={l.code}>
                              {l.label} ({l.code})
                            </option>
                          ))}
                        </select>
                        <input
                          className={INPUT_CLASS}
                          placeholder="Custom locale (optional, overrides list — e.g. pt_BR)"
                          value={createTplLanguageCustom}
                          onChange={(e) => setCreateTplLanguageCustom(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-zinc-400">Category</label>
                        <select
                          className={INPUT_CLASS}
                          value={createTplCategory}
                          onChange={(e) =>
                            setCreateTplCategory(e.target.value as "UTILITY" | "MARKETING" | "AUTHENTICATION")
                          }
                        >
                          <option value="UTILITY">Utility</option>
                          <option value="MARKETING">Marketing</option>
                          <option value="AUTHENTICATION">Authentication</option>
                        </select>
                      </div>
                    </div>
                    <input
                      className={INPUT_CLASS}
                      placeholder="Header text (optional, no variables)"
                      value={createTplHeader}
                      onChange={(e) => setCreateTplHeader(e.target.value)}
                    />
                    <textarea
                      className={INPUT_CLASS}
                      rows={4}
                      placeholder="Body text. Use {{1}}, {{2}} for variables (left‑to‑right order)."
                      value={createTplBody}
                      onChange={(e) => setCreateTplBody(e.target.value)}
                    />
                    {createTplPhOrder.length > 0 && (
                      <div className="space-y-2 rounded-xl border border-zinc-600 bg-zinc-800/50/80 p-3">
                        <p className="text-xs font-medium text-zinc-300">Template variables</p>
                        <p className="text-xs text-zinc-500">
                          For each <code className="rounded bg-white px-1">{"{{n}}"}</code>, choose a Meta variable name (lowercase,
                          underscores) and a sample value Meta uses during review.
                        </p>
                        <ul className="space-y-2">
                          {createTplPhOrder.map((n, i) => (
                            <li key={`${n}-${i}`} className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                                  {"{{"}
                                  {n}
                                  {"}}"} — variable name
                                </label>
                                <input
                                  className={INPUT_CLASS}
                                  placeholder="e.g. customer_name"
                                  value={createTplVarRows[i]?.paramName ?? ""}
                                  onChange={(e) => {
                                    const next = [...createTplVarRows];
                                    next[i] = { ...next[i], paramName: e.target.value };
                                    setCreateTplVarRows(next);
                                  }}
                                  autoComplete="off"
                                />
                              </div>
                              <div>
                                <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                                  Sample value
                                </label>
                                <input
                                  className={INPUT_CLASS}
                                  placeholder="e.g. Alex"
                                  value={createTplVarRows[i]?.example ?? ""}
                                  onChange={(e) => {
                                    const next = [...createTplVarRows];
                                    next[i] = { ...next[i], example: e.target.value };
                                    setCreateTplVarRows(next);
                                  }}
                                />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <input
                      className={INPUT_CLASS}
                      placeholder="Footer (optional)"
                      value={createTplFooter}
                      onChange={(e) => setCreateTplFooter(e.target.value)}
                    />
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={createTplAllowCat}
                        onChange={(e) => setCreateTplAllowCat(e.target.checked)}
                        className="rounded border-zinc-500"
                      />
                      Allow Meta to adjust category if needed
                    </label>
                    <button
                      className={BTN_PRIMARY_BLUE}
                      type="submit"
                      disabled={creatingTemplate || !wabaConnections.length}
                    >
                      {creatingTemplate ? (
                        <>
                          <Spinner /> Submitting…
                        </>
                      ) : (
                        "Submit to Meta"
                      )}
                    </button>
                    <InlineFeedbackText feedback={inlineFeedback.templateCreate} />
                  </form>
                </div>

                <div className={`${CARD_CLASS} space-y-3`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-zinc-100">Template library</h2>
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex gap-2">
                        <button className="rounded-xl border border-zinc-500 px-3 py-2 text-sm hover:bg-zinc-800/50" type="button" onClick={() => loadTemplates("templatesToolbar")}>
                          Load
                        </button>
                        <button
                          className="rounded-xl border border-zinc-500 px-3 py-2 text-sm hover:bg-zinc-800/50"
                          type="button"
                          onClick={() => syncTemplates("templatesToolbar")}
                        >
                          Sync from Meta
                        </button>
                      </div>
                      <InlineFeedbackText feedback={inlineFeedback.templatesToolbar} />
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {templateItems.map((item) => (
                      <div key={item.id} className="rounded-xl border border-zinc-600 p-3">
                        <p className="text-sm font-semibold">{item.name}</p>
                        <p className="text-xs text-zinc-500">{item.language}</p>
                        <p className="text-xs text-zinc-500">{item.category || "No category"}</p>
                        <span className={templateStatusBadgeClass(item.status)}>
                          {item.status || "unknown"}
                        </span>
                        {item.preview_text?.trim() && (
                          <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-zinc-400">{item.preview_text.trim()}</p>
                        )}
                        {item.body_variables && item.body_variables.length > 0 && (
                          <p className="mt-1 text-[10px] text-zinc-500">
                            Variables: {item.body_variables.map((v) => (/^\d+$/.test(v) ? `{{${v}}}` : v)).join(", ")}
                          </p>
                        )}
                        {isApprovedTemplate(item) ? (
                          <button
                            type="button"
                            className="mt-2 rounded-lg border border-indigo-500 px-2 py-1 text-xs text-indigo-200 hover:bg-indigo-950/40"
                            onClick={() => startApiCampaignFromTemplate(item)}
                          >
                            Create API campaign
                          </button>
                        ) : (
                          <p className="mt-2 text-[10px] text-zinc-500">
                            After Meta approves, sync templates, then create an API campaign here.
                          </p>
                        )}
                      </div>
                    ))}
                    {templateItems.length === 0 && <p className="text-sm text-zinc-500">No templates loaded yet.</p>}
                  </div>
                </div>
              </section>
            )}

            {activeTab === "inbox" && (
              <section className="grid gap-4 lg:grid-cols-2">
                <div className={`${CARD_CLASS} space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-zinc-100">Inbox Conversations</h2>
                      <p className="text-xs text-zinc-500">
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" /> Live auto-refresh
                        {inboxLastSyncedAt ? ` | Last sync: ${inboxLastSyncedAt}` : ""}
                      </p>
                    </div>
                    <button className="rounded-xl border border-zinc-500 px-3 py-2 text-sm hover:bg-zinc-800/50" type="button" onClick={() => loadConversations("inboxList")}>
                      Refresh
                    </button>
                  </div>
                  <InlineFeedbackText feedback={inlineFeedback.inboxList} />
                  <TagChipPicker
                    tags={tags}
                    selectedIds={inboxFilterTagId ? [inboxFilterTagId] : []}
                    onChange={(ids) => setInboxFilterTagId(ids[0] ?? null)}
                    counts={inboxTagCounts}
                    allowMultiple={false}
                    showAllOption
                    allSelected={!inboxFilterTagId}
                    onSelectAll={() => setInboxFilterTagId(null)}
                    emptyLabel="No tags yet — create them on the Contacts tab."
                  />
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-crm-accent/25 bg-crm-accent/10 px-3 py-2">
                    <p className="text-sm text-zinc-200">
                      {inboxFilterTagName ? `Chats · ${inboxFilterTagName}` : "All chats"}
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-crm-accent">
                      {filteredInboxConversations.length} conversation{filteredInboxConversations.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="max-h-80 space-y-2 overflow-auto">
                    {filteredInboxConversations.map((item) => (
                      <button
                        key={item.conversation_id}
                        className={`w-full rounded-xl border p-3 text-left ${
                          selectedConversation?.conversation_id === item.conversation_id
                            ? "border-crm-accent bg-crm-accent/15"
                            : "border-zinc-600 bg-zinc-900/50"
                        }`}
                        onClick={() => loadConversationMessages(item)}
                      >
                        <p className="text-sm font-medium">{item.contact_name || "Unknown contact"}</p>
                        <p className="text-xs text-zinc-500">{item.phone_e164}</p>
                        {(item.tags?.length ?? 0) > 0 && (
                          <p className="mt-1 text-[10px] text-zinc-500">
                            {(item.tags ?? []).map((tag) => tag.name).join(" · ")}
                          </p>
                        )}
                        {item.messaging_window && (
                          <span className={`mt-1 inline-block ${windowBadgeClass(item.messaging_window)}`}>
                            {windowBadgeLabel(item.messaging_window)}
                          </span>
                        )}
                      </button>
                    ))}
                    {filteredInboxConversations.length === 0 && (
                      <p className="text-sm text-zinc-500">
                        {inboxFilterTagName
                          ? `No inbox chats for “${inboxFilterTagName}” yet.`
                          : "No conversations yet"}
                      </p>
                    )}
                  </div>
                </div>

                <div className={`${CARD_CLASS} space-y-3`}>
                  <h2 className="text-base font-semibold text-zinc-100">Conversation Thread</h2>
                  {selectedConversation?.messaging_window && (
                    <div
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        selectedConversation.messaging_window.can_send_session
                          ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-100"
                          : "border-amber-700/60 bg-amber-950/40 text-amber-100"
                      }`}
                    >
                      <p className="font-medium">
                        {selectedConversation.messaging_window.can_send_session
                          ? "24-hour reply window open"
                          : "Template-only — session reply blocked"}
                      </p>
                      <p className="mt-1 text-xs opacity-90">{selectedConversation.messaging_window.session_hint}</p>
                      {selectedConversation.messaging_window.is_open &&
                        selectedConversation.messaging_window.seconds_remaining != null && (
                          <p className="mt-1 text-xs opacity-80">
                            {formatWindowRemaining(selectedConversation.messaging_window.seconds_remaining)}
                          </p>
                        )}
                    </div>
                  )}
                  <InlineFeedbackText feedback={inlineFeedback.inboxThread} />
                  <div className="max-h-72 space-y-2 overflow-auto rounded-xl border border-zinc-600 p-3">
                    {conversationMessages.map((msg) => {
                      const display = getMessageDisplayText(msg.payload as Record<string, unknown> | undefined, msg.type);
                      const showMedia = INBOX_MEDIA_TYPES.has(msg.type);
                      const hidePlaceholder = showMedia && inboxMediaPlaceholderOnly(msg.type, display);
                      return (
                        <div
                          key={msg.id}
                          className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                            msg.direction === "outbound" ? "ml-auto bg-crm-accent text-black" : "bg-zinc-800 text-zinc-200"
                          }`}
                        >
                          {showMedia && (
                            <InboxMessageMedia
                              messageId={msg.id}
                              messageType={msg.type}
                              authToken={token}
                              direction={msg.direction}
                            />
                          )}
                          {!hidePlaceholder && (
                            <div className={`text-[15px] ${showMedia ? "mt-2" : ""}`}>
                              {formatWhatsAppRichText(display, msg.direction === "outbound" ? "outbound" : "inbound")}
                            </div>
                          )}
                          <p className={`mt-1 text-[10px] ${msg.direction === "outbound" ? "text-black/60" : "text-zinc-500"}`}>
                            {msg.status}
                          </p>
                        </div>
                      );
                    })}
                    {conversationMessages.length === 0 && <p className="text-sm text-zinc-500">Select a conversation</p>}
                  </div>
                  <div
                    className={`space-y-2 rounded-xl border p-3 ${
                      selectedConversation?.messaging_window && !selectedConversation.messaging_window.can_send_session
                        ? "border-amber-500/50 bg-amber-950/25 ring-1 ring-amber-500/30"
                        : "border-zinc-600/80 bg-zinc-900/40"
                    }`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Send template</p>
                    {!selectedConversation ? (
                      <p className="text-sm text-zinc-500">Select a conversation to send an approved template.</p>
                    ) : approvedTemplates.length === 0 ? (
                      <p className="text-sm text-amber-200/90">
                        No approved templates loaded. Sync templates from Settings or Templates, then return here.
                      </p>
                    ) : (
                      <>
                        <select
                          className={INPUT_CLASS}
                          value={inboxTemplateKey}
                          onChange={(e) => setInboxTemplateKey(e.target.value)}
                          disabled={sendingInboxTemplate}
                        >
                          <option value="">Select approved template</option>
                          {approvedTemplates.map((item) => (
                            <option key={`${item.name}:${item.language}`} value={`${item.name}__${item.language}`}>
                              {item.name} ({item.language})
                            </option>
                          ))}
                        </select>
                        {(() => {
                          const sel = approvedTemplates.find((it) => `${it.name}__${it.language}` === inboxTemplateKey);
                          if (!sel?.preview_text?.trim()) return null;
                          return (
                            <div className="rounded-lg border border-zinc-600 bg-zinc-800/50 p-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Preview</p>
                              <p className="whitespace-pre-wrap text-sm text-zinc-200">{sel.preview_text.trim()}</p>
                            </div>
                          );
                        })()}
                        <TemplateVariableFields
                          templateKey={inboxTemplateKey}
                          templateItems={approvedTemplates}
                          values={inboxTemplateVars}
                          onChange={(key, value) => setInboxTemplateVars((prev) => ({ ...prev, [key]: value }))}
                          contactName={selectedConversation.contact_name}
                        />
                        <p className="text-[11px] text-zinc-500">
                          For outreach outside the 24-hour window. Authentication templates need the real OTP/code in each
                          variable field.
                        </p>
                        <button
                          type="button"
                          className={BTN_SUCCESS}
                          disabled={!inboxTemplateKey || sendingInboxTemplate}
                          onClick={() => void sendInboxTemplate()}
                        >
                          {sendingInboxTemplate ? (
                            <>
                              <Spinner /> Sending…
                            </>
                          ) : (
                            "Send template"
                          )}
                        </button>
                      </>
                    )}
                    <InlineFeedbackText feedback={inlineFeedback.inboxTemplate} />
                  </div>
                  <form
                    onSubmit={sendReply}
                    className={`space-y-2 ${selectedConversation?.messaging_window && !selectedConversation.messaging_window.can_send_session ? "opacity-60" : ""}`}
                  >
                    {selectedConversation?.messaging_window && !selectedConversation.messaging_window.can_send_session && (
                      <p className="text-xs text-amber-200/90">
                        Session replies are disabled. Use an approved template above to message this contact.
                      </p>
                    )}
                    <input
                      ref={replyFileInputRef}
                      type="file"
                      className="hidden"
                      accept="image/jpeg,image/png,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"
                      onChange={(e) => setReplyAttachment(e.target.files?.[0] ?? null)}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={`${BTN_SECONDARY} !min-h-9 py-1.5 text-xs`}
                        disabled={
                          !selectedConversation ||
                          sendingReply ||
                          (selectedConversation?.messaging_window != null && !selectedConversation.messaging_window.can_send_session)
                        }
                        onClick={() => replyFileInputRef.current?.click()}
                      >
                        Attach image or document
                      </button>
                      {replyAttachment && (
                        <>
                          <span className="max-w-[12rem] truncate text-xs text-zinc-400" title={replyAttachment.name}>
                            {replyAttachment.name}
                          </span>
                          <button
                            type="button"
                            className="text-xs font-medium text-rose-400 underline decoration-rose-400/60 hover:text-rose-300"
                            onClick={clearReplyAttachment}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </div>
                    {replyImagePreviewUrl && (
                      <img
                        src={replyImagePreviewUrl}
                        alt=""
                        className="max-h-36 max-w-full rounded-lg border border-zinc-600 object-contain"
                      />
                    )}
                    <p className="text-[11px] text-zinc-500">
                      Images: JPEG or PNG, max 5 MB. Documents: PDF, Office, TXT, max 32 MB. Text below is optional caption for
                      attachments.
                    </p>
                    <textarea
                      className={INPUT_CLASS}
                      rows={3}
                      placeholder={replyAttachment ? "Optional caption…" : "Type reply…"}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      disabled={
                        selectedConversation?.messaging_window != null && !selectedConversation.messaging_window.can_send_session
                      }
                    />
                    <button
                      className={BTN_PRIMARY}
                      type="submit"
                      disabled={
                        !selectedConversation ||
                        sendingReply ||
                        (!replyText.trim() && !replyAttachment) ||
                        (selectedConversation?.messaging_window != null && !selectedConversation.messaging_window.can_send_session)
                      }
                    >
                      {sendingReply ? (
                        <>
                          <Spinner /> Sending…
                        </>
                      ) : (
                        "Send Reply"
                      )}
                    </button>
                    <InlineFeedbackText feedback={inlineFeedback.inboxReply} />
                  </form>
                </div>
              </section>
            )}
              {activeTab === "analytics" && (
                <>
                  <section className={`${CARD_CLASS} space-y-4`}>
                    <h2 className="text-base font-semibold text-zinc-100">Campaign performance</h2>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-xl border border-zinc-600 p-3">
                        <p className="text-xs text-zinc-500">Total Campaigns</p>
                        <p className="text-xl font-semibold text-zinc-100">{campaigns.length}</p>
                      </div>
                      <div className="rounded-xl border border-zinc-600 p-3">
                        <p className="text-xs text-zinc-500">Scheduled</p>
                        <p className="text-xl font-semibold text-indigo-700">{campaignStats.scheduled}</p>
                      </div>
                      <div className="rounded-xl border border-zinc-600 p-3">
                        <p className="text-xs text-zinc-500">Completed</p>
                        <p className="text-xl font-semibold text-emerald-700">{campaignStats.completed}</p>
                      </div>
                      <div className="rounded-xl border border-zinc-600 p-3">
                        <p className="text-xs text-zinc-500">Pending / Queued</p>
                        <p className="text-xl font-semibold text-amber-700">{campaignStats.queued}</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-zinc-600">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-zinc-800/50 text-zinc-400">
                          <tr>
                            <th className="px-3 py-2">Campaign</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Recipients</th>
                            <th className="px-3 py-2">Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaigns.map((campaign) => (
                            <tr key={campaign.id} className="border-t border-zinc-700">
                              <td className="px-3 py-2">{campaign.name}</td>
                              <td className="px-3 py-2">{campaign.status}</td>
                              <td className="px-3 py-2">{campaign.recipients.length}</td>
                              <td className="px-3 py-2">{new Date(campaign.updated_at).toLocaleString()}</td>
                            </tr>
                          ))}
                          {campaigns.length === 0 && (
                            <tr>
                              <td className="px-3 py-4 text-center text-zinc-500" colSpan={4}>
                                No campaign data yet. Create and start campaigns to see analytics.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className={`${CARD_CLASS} space-y-4`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold text-zinc-100">Tag performance</h2>
                        <p className="mt-1 text-sm text-zinc-400">
                          Campaign messages and estimated spend grouped by CRM tag (e.g. Class 6). Based on sends to contacts
                          that currently carry each tag.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                            tagPerfDays === 0 ? "bg-crm-accent text-black" : "border border-zinc-500 bg-zinc-800 text-zinc-300"
                          }`}
                          onClick={() => setTagPerfDays(0)}
                        >
                          All time
                        </button>
                        <button
                          type="button"
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                            tagPerfDays === 7 ? "bg-crm-accent text-black" : "border border-zinc-500 bg-zinc-800 text-zinc-300"
                          }`}
                          onClick={() => setTagPerfDays(7)}
                        >
                          7 days
                        </button>
                        <button
                          type="button"
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                            tagPerfDays === 30 ? "bg-crm-accent text-black" : "border border-zinc-500 bg-zinc-800 text-zinc-300"
                          }`}
                          onClick={() => setTagPerfDays(30)}
                        >
                          30 days
                        </button>
                        <button
                          type="button"
                          className={BTN_PRIMARY_BLUE}
                          disabled={tagPerfLoading || !token}
                          onClick={() => void loadTagPerformance()}
                        >
                          {tagPerfLoading ? (
                            <>
                              <Spinner /> Loading…
                            </>
                          ) : (
                            "Refresh"
                          )}
                        </button>
                      </div>
                    </div>
                    <InlineFeedbackText feedback={inlineFeedback.tagPerf} />
                    {tagPerfData && (
                      <>
                        <p className="text-xs text-zinc-500">{tagPerfData.disclaimer}</p>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="rounded-xl border border-zinc-600 p-3">
                            <p className="text-xs text-zinc-500">Messages sent (all tags)</p>
                            <p className="text-xl font-semibold text-emerald-400">{tagPerfData.summary_messages_sent}</p>
                          </div>
                          <div className="rounded-xl border border-zinc-600 p-3">
                            <p className="text-xs text-zinc-500">Failed</p>
                            <p className="text-xl font-semibold text-red-400">{tagPerfData.summary_messages_failed}</p>
                          </div>
                          <div className="rounded-xl border border-zinc-600 p-3">
                            <p className="text-xs text-zinc-500">Estimated cost (INR)</p>
                            <p className="text-xl font-semibold text-zinc-100">{formatMetaInr(tagPerfData.summary_estimated_cost_inr)}</p>
                          </div>
                        </div>
                        <div className="overflow-x-auto rounded-xl border border-zinc-600">
                          <table className="min-w-full text-left text-sm">
                            <thead className="bg-zinc-800/50 text-zinc-400">
                              <tr>
                                <th className="px-3 py-2">Tag</th>
                                <th className="px-3 py-2">Contacts</th>
                                <th className="px-3 py-2">Sent</th>
                                <th className="px-3 py-2">Failed</th>
                                <th className="px-3 py-2">Pending</th>
                                <th className="px-3 py-2">Est. cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tagPerfData.tags.map((row) => (
                                <tr key={row.tag_id} className="border-t border-zinc-700">
                                  <td className="px-3 py-2 font-medium text-zinc-100">{row.tag_name}</td>
                                  <td className="px-3 py-2 tabular-nums">{row.contact_count}</td>
                                  <td className="px-3 py-2 tabular-nums text-emerald-300">{row.messages_sent}</td>
                                  <td className="px-3 py-2 tabular-nums text-red-300">{row.messages_failed}</td>
                                  <td className="px-3 py-2 tabular-nums text-amber-300">{row.messages_pending}</td>
                                  <td className="px-3 py-2 tabular-nums">{formatMetaInr(row.estimated_cost_inr)}</td>
                                </tr>
                              ))}
                              {tagPerfData.tags.length === 0 && (
                                <tr>
                                  <td className="px-3 py-4 text-center text-zinc-500" colSpan={6}>
                                    No tags yet. Create tags on Contacts, import students, then run tag campaigns.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {!tagPerfData && !tagPerfLoading && (
                      <p className="text-sm text-zinc-500">Click Refresh to load tag performance.</p>
                    )}
                  </section>

                  <section className={`${CARD_CLASS} space-y-4`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold text-zinc-100">Meta spend (pricing analytics)</h2>
                        <p className="mt-1 text-sm text-zinc-400">
                          Pulled from Meta&apos;s <code className="rounded bg-zinc-800 px-1 text-xs">pricing_analytics</code> for your
                          WABA. Costs are shown in <span className="font-medium text-zinc-200">Indian Rupees (INR)</span>; period labels
                          use <span className="font-medium text-zinc-200">IST (Asia/Kolkata)</span>. Official totals: Meta Billing Hub.
                        </p>
                      </div>
                      <button
                        type="button"
                        className={BTN_PRIMARY_BLUE}
                        disabled={metaPricingLoading || !token}
                        onClick={() => void loadMetaPricingAnalytics()}
                      >
                        {metaPricingLoading ? (
                          <>
                            <Spinner /> Loading…
                          </>
                        ) : (
                          "Load from Meta"
                        )}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-600 bg-zinc-800/50/60 p-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-400">Range</label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                              metaPricingDays === 7 ? "bg-crm-accent text-black" : "border border-zinc-500 bg-zinc-800 text-zinc-300"
                            }`}
                            onClick={() => setMetaPricingDays(7)}
                          >
                            Last 7 days
                          </button>
                          <button
                            type="button"
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                              metaPricingDays === 30 ? "bg-crm-accent text-black" : "border border-zinc-500 bg-zinc-800 text-zinc-300"
                            }`}
                            onClick={() => setMetaPricingDays(30)}
                          >
                            Last 30 days
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-400">Granularity</label>
                        <select
                          className={INPUT_CLASS}
                          value={metaPricingGranularity}
                          onChange={(e) => setMetaPricingGranularity(e.target.value as "DAILY" | "HALF_HOUR" | "MONTHLY")}
                        >
                          <option value="DAILY">Daily</option>
                          <option value="HALF_HOUR">Half hour</option>
                          <option value="MONTHLY">Monthly</option>
                        </select>
                      </div>
                      <div className="min-w-[140px] flex-1">
                        <label className="mb-1 block text-xs font-medium text-zinc-400">Countries (optional)</label>
                        <input
                          className={INPUT_CLASS}
                          placeholder="e.g. US,IN"
                          value={metaPricingCountryFilter}
                          onChange={(e) => setMetaPricingCountryFilter(e.target.value)}
                        />
                      </div>
                    </div>

                    <InlineFeedbackText feedback={inlineFeedback.metaPricing} />

                    {metaPricingData && (
                      <>
                        <p className="text-xs text-zinc-500">{metaPricingData.disclaimer}</p>
                        <p className="text-xs text-zinc-500">
                          WABA <span className="font-mono">{metaPricingData.waba_id}</span>
                          {metaPricingData.connection_label ? ` · Connection: ${metaPricingData.connection_label}` : ""}
                          <br />
                          Fetched {formatMetaFetchedAtIso(metaPricingData.fetched_at)} IST · Range{" "}
                          {formatMetaRangeDateFromUnix(metaPricingData.start_ts)} – {formatMetaRangeDateFromUnix(metaPricingData.end_ts)}{" "}
                          (IST) · {metaPricingData.granularity}
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border border-zinc-600 bg-zinc-800/40 p-4">
                            <p className="text-xs font-medium text-zinc-500">Approx. total cost (sum of buckets)</p>
                            <p className="mt-1 text-2xl font-semibold tabular-nums text-crm-accent">
                              {formatMetaInr(metaPricingData.summary_total_cost)}
                            </p>
                            <p className="mt-1 text-[11px] text-zinc-400">Indian Rupees (INR)</p>
                          </div>
                          <div className="rounded-xl border border-zinc-600 bg-zinc-800/40 p-4">
                            <p className="text-xs font-medium text-zinc-500">Delivered volume (summed)</p>
                            <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
                              {metaPricingData.summary_total_volume}
                            </p>
                            <p className="mt-1 text-[11px] text-zinc-400">Message delivery counts in returned rows</p>
                          </div>
                        </div>

                        {metaPricingByCategory.length > 0 && (
                          <div className="rounded-xl border border-zinc-600">
                            <p className="border-b border-zinc-700 bg-zinc-800/50 px-3 py-2 text-xs font-semibold text-zinc-400">
                              By pricing category
                            </p>
                            <table className="min-w-full text-left text-sm">
                              <thead className="bg-zinc-800/50/80 text-zinc-400">
                                <tr>
                                  <th className="px-3 py-2">Category</th>
                                  <th className="px-3 py-2">Cost</th>
                                  <th className="px-3 py-2">Volume</th>
                                </tr>
                              </thead>
                              <tbody>
                                {metaPricingByCategory.map(([cat, agg]) => (
                                  <tr key={cat} className="border-t border-zinc-700">
                                    <td className="px-3 py-2 font-medium">{cat}</td>
                                    <td className="px-3 py-2 tabular-nums">{formatMetaInr(agg.cost)}</td>
                                    <td className="px-3 py-2 tabular-nums">{agg.volume}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        <div className="max-h-80 overflow-auto rounded-xl border border-zinc-600">
                          <table className="min-w-full text-left text-sm">
                            <thead className="sticky top-0 bg-zinc-800/50 text-zinc-400">
                              <tr>
                                <th className="px-3 py-2">Period start (IST)</th>
                                <th className="px-3 py-2">Country</th>
                                <th className="px-3 py-2">Category</th>
                                <th className="px-3 py-2">Type</th>
                                <th className="px-3 py-2">Tier</th>
                                <th className="px-3 py-2 text-right">Volume</th>
                                <th className="px-3 py-2 text-right">Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {metaPricingData.data_points.map((row, idx) => (
                                <tr key={`${row.start}-${row.end}-${idx}`} className="border-t border-zinc-700">
                                  <td className="px-3 py-2 text-zinc-400">
                                    {formatMetaPricingBucketStart(row.start, metaPricingData.granularity)}
                                  </td>
                                  <td className="px-3 py-2">{row.country || "—"}</td>
                                  <td className="px-3 py-2">{row.pricing_category || "—"}</td>
                                  <td className="px-3 py-2">{row.pricing_type || "—"}</td>
                                  <td className="px-3 py-2 text-xs">{row.tier || "—"}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">{row.volume ?? "—"}</td>
                                  <td className="px-3 py-2 text-right tabular-nums">
                                    {row.cost != null ? formatMetaInr(row.cost) : "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}

                    {!metaPricingData && !metaPricingLoading && (
                      <p className="text-sm text-zinc-500">Choose a range and click Load from Meta to fetch pricing analytics.</p>
                    )}
                  </section>
                </>
              )}
              {activeTab === "automations" && (
                <section className={`${CARD_CLASS} space-y-2`}>
                  <h2 className="text-base font-semibold text-zinc-100">Automations</h2>
                  <p className="text-sm text-zinc-400">
                    Rule-based flows, triggers, and sequences will live here. The workspace metrics above stay in sync when you use{" "}
                    <span className="font-medium text-zinc-200">Refresh workspace data</span>.
                  </p>
                </section>
              )}
              {activeTab === "platform" && isSuperAdmin && (
                <section className="space-y-4">
                  {platformMonitorTenantId ? (
                    <>
                      <div className={`${CARD_CLASS} flex flex-wrap items-start justify-between gap-3`}>
                        <div className="space-y-2">
                          <button
                            type="button"
                            className="text-xs font-semibold text-crm-accent hover:underline"
                            onClick={closePlatformMonitor}
                          >
                            ← Back to agent accounts
                          </button>
                          <div>
                            <h3 className="text-base font-semibold text-zinc-100">
                              {platformOverview?.tenant.name ?? "Agent workspace"}
                            </h3>
                            <p className="text-sm text-zinc-400">
                              {platformOverview?.agent.email ?? "—"}
                              {platformOverview?.tenant.slug ? (
                                <span className="text-zinc-600"> · {platformOverview.tenant.slug}</span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          className={`${BTN_SECONDARY} !min-h-0 py-2 text-xs`}
                          disabled={platformOverviewLoading}
                          onClick={() => void loadPlatformAgentOverview(platformMonitorTenantId)}
                        >
                          {platformOverviewLoading ? (
                            <>
                              <Spinner className="h-3.5 w-3.5" /> Refreshing…
                            </>
                          ) : (
                            "Refresh snapshot"
                          )}
                        </button>
                      </div>
                      <div className="rounded-2xl border border-sky-500/40 bg-sky-950/30 px-4 py-3 text-sm text-sky-100">
                        <p className="font-semibold">Read-only client monitor</p>
                        <p className="mt-1 text-sky-200/90">
                          Super-admin view for service delivery. You can inspect chats and metrics but cannot send messages from
                          this screen.
                        </p>
                      </div>
                      <InlineFeedbackText feedback={inlineFeedback.platformMonitor} />
                      {platformOverviewLoading && !platformOverview ? (
                        <div className={`${CARD_CLASS} py-12 text-center text-sm text-zinc-500`}>Loading workspace snapshot…</div>
                      ) : platformOverview ? (
                        <>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                            <div className={CARD_CLASS}>
                              <p className="text-xs text-zinc-500">Active chats (24h)</p>
                              <p className="mt-1 text-2xl font-semibold tabular-nums text-lime-400">
                                {platformOverview.metrics.active_service_windows}
                              </p>
                            </div>
                            <div className={CARD_CLASS}>
                              <p className="text-xs text-zinc-500">Conversations</p>
                              <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
                                {platformOverview.metrics.conversations_total}
                              </p>
                            </div>
                            <div className={CARD_CLASS}>
                              <p className="text-xs text-zinc-500">Contacts</p>
                              <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
                                {platformOverview.metrics.contacts_total}
                              </p>
                            </div>
                            <div className={CARD_CLASS}>
                              <p className="text-xs text-zinc-500">Sent today</p>
                              <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
                                {platformOverview.metrics.messages_sent_today}
                              </p>
                            </div>
                            <div className={CARD_CLASS}>
                              <p className="text-xs text-zinc-500">Received today</p>
                              <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
                                {platformOverview.metrics.messages_received_today}
                              </p>
                            </div>
                            <div className={CARD_CLASS}>
                              <p className="text-xs text-zinc-500">Templates approved</p>
                              <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-400">
                                {platformOverview.metrics.templates_approved}
                                <span className="text-sm font-normal text-zinc-500">
                                  /{platformOverview.metrics.templates_total}
                                </span>
                              </p>
                            </div>
                          </div>
                          <div className="grid gap-3 lg:grid-cols-3">
                            <div className={`${CARD_CLASS} space-y-2 lg:col-span-1`}>
                              <h4 className="text-sm font-semibold text-zinc-100">Account health</h4>
                              <p className="text-xs text-zinc-500">
                                Setup:{" "}
                                <span className="text-zinc-300">
                                  {platformOverview.tenant.setup_status === "active" ? "Active CRM" : "Pending Meta"}
                                </span>
                              </p>
                              <p className="text-xs text-zinc-500">
                                Agent login:{" "}
                                <span className={platformOverview.agent.is_active ? "text-lime-400" : "text-zinc-400"}>
                                  {platformOverview.agent.is_active ? "Enabled" : "Disabled"}
                                </span>
                              </p>
                              {platformOverview.meta_health && (
                                <p className="text-xs text-zinc-500">
                                  Meta:{" "}
                                  <span className="text-zinc-300">{platformOverview.meta_health.overall}</span>
                                  {platformOverview.meta_health.token_alert_message ? (
                                    <span className="mt-1 block text-rose-300/90">
                                      {platformOverview.meta_health.token_alert_message}
                                    </span>
                                  ) : null}
                                </p>
                              )}
                              {(() => {
                                const waLine = platformWhatsAppNumberLine(
                                  platformOverview.meta_health,
                                  platformOverview.whatsapp
                                );
                                if (!waLine.primary && !waLine.secondary) return null;
                                return (
                                  <div className="text-xs text-zinc-500">
                                    <p>
                                      WhatsApp number:{" "}
                                      <span className="font-medium text-zinc-200">{waLine.primary ?? "—"}</span>
                                    </p>
                                    {waLine.secondary && (
                                      <p className="mt-0.5 text-[10px] text-zinc-600">{waLine.secondary}</p>
                                    )}
                                  </div>
                                );
                              })()}
                              <p className="text-xs text-zinc-500">
                                Last message:{" "}
                                <span className="text-zinc-300">
                                  {platformOverview.metrics.last_message_at
                                    ? new Date(platformOverview.metrics.last_message_at).toLocaleString()
                                    : "—"}
                                </span>
                              </p>
                            </div>
                            <div className={`${CARD_CLASS} space-y-2 lg:col-span-1`}>
                              <h4 className="text-sm font-semibold text-zinc-100">Messaging totals</h4>
                              <p className="text-sm text-zinc-400">
                                <span className="font-semibold text-zinc-200">{platformOverview.metrics.messages_total}</span> total
                                · {platformOverview.metrics.messages_outbound} sent · {platformOverview.metrics.messages_inbound}{" "}
                                received
                              </p>
                              <p className="text-sm text-zinc-400">
                                Campaigns: {platformOverview.metrics.campaigns_total} · recipients sent:{" "}
                                {platformOverview.metrics.campaign_recipients_sent}
                              </p>
                              <p className="text-sm text-zinc-400">
                                Tags: {platformOverview.metrics.tags_total} · API keys:{" "}
                                {platformOverview.metrics.integration_keys}
                              </p>
                            </div>
                            <div className={`${CARD_CLASS} space-y-2 lg:col-span-1`}>
                              <h4 className="text-sm font-semibold text-zinc-100">Last 14 days</h4>
                              <div className="max-h-40 space-y-1 overflow-y-auto text-xs">
                                {platformOverview.metrics.messages_by_day.length === 0 ? (
                                  <p className="text-zinc-500">No messages in this period.</p>
                                ) : (
                                  platformOverview.metrics.messages_by_day.map((row) => (
                                    <div key={row.date ?? "unknown"} className="flex justify-between gap-2 text-zinc-400">
                                      <span>{row.date}</span>
                                      <span className="tabular-nums">
                                        ↑{row.inbound} · ↓{row.outbound}
                                      </span>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                          <div className={`${CARD_CLASS} space-y-3`}>
                            <h4 className="text-sm font-semibold text-zinc-100">Template library</h4>
                            {platformOverview.templates.length === 0 ? (
                              <p className="text-sm text-zinc-500">No templates synced yet.</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="min-w-full text-left text-xs">
                                  <thead>
                                    <tr className="border-b border-zinc-700 text-zinc-500">
                                      <th className="px-2 py-1.5 font-semibold">Name</th>
                                      <th className="px-2 py-1.5 font-semibold">Language</th>
                                      <th className="px-2 py-1.5 font-semibold">Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {platformOverview.templates.map((tpl) => (
                                      <tr key={tpl.id} className="border-b border-zinc-800/80">
                                        <td className="px-2 py-2 text-zinc-200">{tpl.name}</td>
                                        <td className="px-2 py-2 text-zinc-400">{tpl.language}</td>
                                        <td className="px-2 py-2">
                                          <span
                                            className={`rounded-full px-2 py-0.5 font-semibold ${
                                              (tpl.status || "").toUpperCase() === "APPROVED"
                                                ? "bg-lime-500/20 text-lime-400"
                                                : "bg-amber-500/20 text-amber-300"
                                            }`}
                                          >
                                            {tpl.status || "unknown"}
                                          </span>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className={`${CARD_CLASS} space-y-2`}>
                              <h4 className="text-sm font-semibold text-zinc-100">Inbox (read-only)</h4>
                              <div className="max-h-80 space-y-2 overflow-y-auto">
                                {platformMonitorConversations.map((item) => (
                                  <button
                                    key={item.conversation_id}
                                    type="button"
                                    onClick={() => {
                                      setPlatformMonitorConversation(item);
                                      void loadPlatformMonitorMessages(platformMonitorTenantId, item.conversation_id, true);
                                    }}
                                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                                      platformMonitorConversation?.conversation_id === item.conversation_id
                                        ? "border-crm-accent bg-crm-accent/10"
                                        : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-500"
                                    }`}
                                  >
                                    <p className="font-medium text-zinc-100">{item.contact_name || "Unnamed"}</p>
                                    <p className="text-xs text-zinc-500">{item.phone_e164}</p>
                                    {item.messaging_window && (
                                      <span className={`mt-1 inline-block ${windowBadgeClass(item.messaging_window)}`}>
                                        {windowBadgeLabel(item.messaging_window)}
                                      </span>
                                    )}
                                  </button>
                                ))}
                                {platformMonitorConversations.length === 0 && (
                                  <p className="text-sm text-zinc-500">No conversations yet.</p>
                                )}
                              </div>
                            </div>
                            <div className={`${CARD_CLASS} space-y-3`}>
                              <h4 className="text-sm font-semibold text-zinc-100">Conversation thread</h4>
                              {platformMonitorConversation?.messaging_window && (
                                <p className="text-xs text-zinc-500">
                                  {platformMonitorConversation.messaging_window.session_hint}
                                </p>
                              )}
                              <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-zinc-600 p-3">
                                {platformMonitorMessagesLoading ? (
                                  <p className="text-sm text-zinc-500">Loading messages…</p>
                                ) : (
                                  platformMonitorMessages.map((msg) => {
                                    const display = getMessageDisplayText(msg.payload, msg.type);
                                    return (
                                      <div
                                        key={msg.id}
                                        className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                                          msg.direction === "outbound"
                                            ? "ml-auto bg-crm-accent text-black"
                                            : "bg-zinc-800 text-zinc-200"
                                        }`}
                                      >
                                        <div className="text-[15px]">{formatWhatsAppRichText(display, msg.direction === "outbound" ? "outbound" : "inbound")}</div>
                                        <p
                                          className={`mt-1 text-[10px] ${
                                            msg.direction === "outbound" ? "text-black/60" : "text-zinc-500"
                                          }`}
                                        >
                                          {new Date(msg.created_at).toLocaleString()} · {msg.status}
                                        </p>
                                      </div>
                                    );
                                  })
                                )}
                                {!platformMonitorMessagesLoading && platformMonitorMessages.length === 0 && (
                                  <p className="text-sm text-zinc-500">Select a conversation to view messages.</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                  <div className={`${CARD_CLASS} flex flex-wrap items-center justify-between gap-3`}>
                    <div>
                      <h3 className="text-base font-semibold text-zinc-100">Agent accounts</h3>
                      <p className="text-sm text-zinc-400">
                        Create agent workspaces. Click a row to monitor usage. Agents complete WhatsApp Settings to activate their CRM.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`${BTN_SECONDARY} !min-h-0 py-2 text-xs`}
                      disabled={platformLoading}
                      onClick={() => void loadPlatformData()}
                    >
                      {platformLoading ? (
                        <>
                          <Spinner className="h-3.5 w-3.5" /> Refreshing…
                        </>
                      ) : (
                        "Refresh platform data"
                      )}
                    </button>
                  </div>
                  <InlineFeedbackText feedback={inlineFeedback.platformPanel} />
                  {platformSummary && platformSummary.agents_token_attention > 0 && (
                    <div className="rounded-2xl border border-rose-500/50 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
                      <p className="font-semibold">Meta token attention needed</p>
                      <p className="mt-1 text-rose-200/90">
                        {platformSummary.agents_token_attention} agent
                        {platformSummary.agents_token_attention === 1 ? "" : "s"} ha
                        {platformSummary.agents_token_attention === 1 ? "s" : "ve"} a missing, expired, or invalid WhatsApp access token.
                        Ask the agent to update WhatsApp Settings or reset their connection.
                      </p>
                    </div>
                  )}
                  {platformSummary && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                      <div className={CARD_CLASS}>
                        <p className="text-xs text-zinc-500">Total agents</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">{platformSummary.agents_total}</p>
                      </div>
                      <div className={CARD_CLASS}>
                        <p className="text-xs text-zinc-500">Active</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums text-lime-400">{platformSummary.agents_active}</p>
                      </div>
                      <div className={CARD_CLASS}>
                        <p className="text-xs text-zinc-500">Pending Meta setup</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-300">
                          {platformSummary.agents_pending_meta}
                        </p>
                      </div>
                      <div className={CARD_CLASS}>
                        <p className="text-xs text-zinc-500">Token alerts</p>
                        <p
                          className={`mt-1 text-2xl font-semibold tabular-nums ${
                            platformSummary.agents_token_attention > 0 ? "text-rose-400" : "text-zinc-100"
                          }`}
                        >
                          {platformSummary.agents_token_attention}
                        </p>
                      </div>
                      <div className={CARD_CLASS}>
                        <p className="text-xs text-zinc-500">Disabled</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-400">{platformSummary.agents_disabled}</p>
                      </div>
                      <div className={CARD_CLASS}>
                        <p className="text-xs text-zinc-500">WhatsApp connections</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-100">
                          {platformSummary.whatsapp_connections}
                        </p>
                      </div>
                    </div>
                  )}
                  <form onSubmit={handleCreateAgent} className={`${CARD_CLASS} grid gap-3 md:grid-cols-2`}>
                    <h3 className="text-base font-semibold text-zinc-100 md:col-span-2">Create agent account</h3>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-500">Agent email</label>
                      <input
                        className={INPUT_CLASS}
                        type="email"
                        required
                        value={newAgentEmail}
                        onChange={(e) => setNewAgentEmail(e.target.value)}
                        placeholder="agent@company.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-500">Temporary password</label>
                      <input
                        className={INPUT_CLASS}
                        type="password"
                        required
                        minLength={8}
                        value={newAgentPassword}
                        onChange={(e) => setNewAgentPassword(e.target.value)}
                        placeholder="Min 8 characters"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-500">Agent name (optional)</label>
                      <input
                        className={INPUT_CLASS}
                        value={newAgentFullName}
                        onChange={(e) => setNewAgentFullName(e.target.value)}
                        placeholder="Full name"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-500">Workspace name</label>
                      <input
                        className={INPUT_CLASS}
                        required
                        value={newAgentTenantName}
                        onChange={(e) => {
                          const name = e.target.value;
                          setNewAgentTenantName(name);
                          if (!newAgentSlugManual) {
                            setNewAgentTenantSlug(slugifyWorkspaceName(name));
                          }
                        }}
                        placeholder="Acme Sales"
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-zinc-500">Workspace ID (slug)</label>
                        {newAgentSlugManual ? (
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-crm-accent hover:underline"
                            onClick={() => {
                              setNewAgentSlugManual(false);
                              setNewAgentTenantSlug(slugifyWorkspaceName(newAgentTenantName));
                            }}
                          >
                            Auto-generate from name
                          </button>
                        ) : (
                          <span className="text-[11px] text-zinc-600">Auto from workspace name</span>
                        )}
                      </div>
                      <input
                        className={`${INPUT_CLASS} ${!newAgentSlugManual ? "text-zinc-400" : ""}`}
                        readOnly={!newAgentSlugManual}
                        pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
                        value={newAgentTenantSlug}
                        onChange={(e) => {
                          setNewAgentSlugManual(true);
                          setNewAgentTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                        }}
                        placeholder={slugifyWorkspaceName(newAgentTenantName) || "acme-sales"}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <button type="submit" className={BTN_PRIMARY} disabled={creatingAgent || platformLoading}>
                        {creatingAgent ? "Creating…" : "Create agent account"}
                      </button>
                    </div>
                  </form>
                  <div className={`${CARD_CLASS} overflow-x-auto`}>
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-700 text-xs uppercase tracking-wide text-zinc-500">
                          <th className="px-3 py-2 font-semibold">Workspace</th>
                          <th className="px-3 py-2 font-semibold">Agent</th>
                          <th className="px-3 py-2 font-semibold">Status</th>
                          <th className="px-3 py-2 font-semibold">Meta health</th>
                          <th className="px-3 py-2 font-semibold text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {platformLoading && platformTenants.length === 0 ? (
                          <tr>
                            <td className="px-3 py-8 text-center text-zinc-500" colSpan={5}>
                              Loading…
                            </td>
                          </tr>
                        ) : (
                          platformTenants.map((row) => {
                            const health = row.meta_health;
                            const overall = health?.overall ?? "disconnected";
                            const tokenAlert = health?.token_alert;
                            const isDisabled = row.agent_is_active === false;
                            return (
                              <tr key={row.tenant_id} className="border-b border-zinc-800/80 align-top">
                                <td className="px-3 py-3">
                                  <button
                                    type="button"
                                    className="text-left hover:opacity-90"
                                    onClick={() => openPlatformMonitor(row.tenant_id)}
                                  >
                                    <p className="font-medium text-crm-accent hover:underline">{row.tenant_name}</p>
                                    <p className="text-xs text-zinc-500">{row.tenant_slug}</p>
                                    <p className="mt-1 text-[10px] text-zinc-600">
                                      {row.contact_count} contacts · {row.message_count} messages
                                    </p>
                                  </button>
                                </td>
                                <td className="px-3 py-3 text-xs text-zinc-400">
                                  <button
                                    type="button"
                                    className="text-left hover:opacity-90"
                                    onClick={() => openPlatformMonitor(row.tenant_id)}
                                  >
                                    <p className="text-zinc-300 hover:text-crm-accent hover:underline">
                                      {row.agent_email || row.users[0]?.email || "—"}
                                    </p>
                                    {row.agent_full_name && <p className="text-zinc-500">{row.agent_full_name}</p>}
                                  </button>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex flex-wrap gap-1">
                                    <span
                                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                        row.setup_status === "active"
                                          ? "bg-lime-500/20 text-lime-400"
                                          : "bg-amber-500/20 text-amber-300"
                                      }`}
                                    >
                                      {row.setup_status === "active" ? "active" : "pending Meta"}
                                    </span>
                                    {isDisabled && (
                                      <span className="inline-flex rounded-full bg-zinc-700 px-2 py-0.5 text-xs font-semibold text-zinc-300">
                                        disabled
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-3">
                                  <span
                                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                      overall === "healthy"
                                        ? "bg-lime-500/20 text-lime-400"
                                        : overall === "attention"
                                          ? "bg-amber-500/20 text-amber-300"
                                          : "bg-rose-500/20 text-rose-400"
                                    }`}
                                  >
                                    {overall}
                                  </span>
                                  {tokenAlert === "expired" && (
                                    <p className="mt-1 text-[11px] font-semibold text-rose-400">Token expired</p>
                                  )}
                                  {tokenAlert === "invalid" && (
                                    <p className="mt-1 text-[11px] font-semibold text-amber-300">Token invalid</p>
                                  )}
                                  {health?.token_alert_message && tokenAlert && (
                                    <p className="mt-1 text-[11px] text-rose-400/90">{health.token_alert_message}</p>
                                  )}
                                  {(() => {
                                    const waLine = platformWhatsAppNumberLine(health);
                                    if (!waLine.primary && !waLine.secondary) return null;
                                    return (
                                      <>
                                        {waLine.primary && (
                                          <p className="mt-1 text-[11px] font-medium text-zinc-300">{waLine.primary}</p>
                                        )}
                                        {waLine.secondary && (
                                          <p className="mt-0.5 font-mono text-[10px] text-zinc-500">{waLine.secondary}</p>
                                        )}
                                      </>
                                    );
                                  })()}
                                </td>
                                <td className="px-3 py-3 text-right">
                                  <div className="flex flex-col items-end gap-2">
                                    <button
                                      type="button"
                                      className={`${BTN_ROW} border border-zinc-600 text-zinc-200 hover:bg-zinc-800`}
                                      disabled={agentActionLoading}
                                      onClick={() => void toggleAgentActive(row.tenant_id, isDisabled)}
                                    >
                                      {isDisabled ? "Enable" : "Disable"}
                                    </button>
                                    <button
                                      type="button"
                                      className={`${BTN_ROW} border border-zinc-600 text-zinc-200 hover:bg-zinc-800`}
                                      disabled={agentActionLoading}
                                      onClick={() => {
                                        setAgentActionTenantId(row.tenant_id);
                                        setAgentResetPassword("");
                                      }}
                                    >
                                      Reset password
                                    </button>
                                    <button
                                      type="button"
                                      className={`${BTN_ROW} border border-rose-500/50 text-rose-300 hover:bg-rose-950/50`}
                                      disabled={agentActionLoading || platformDeleting}
                                      onClick={() => {
                                        setPlatformDeleteTarget(row);
                                        setPlatformDeleteConfirmSlug("");
                                      }}
                                    >
                                      Delete account
                                    </button>
                                  </div>
                                  {agentActionTenantId === row.tenant_id && (
                                    <div className="mt-2 space-y-2 text-left">
                                      <input
                                        className={INPUT_CLASS}
                                        type="password"
                                        placeholder="New password (min 8)"
                                        value={agentResetPassword}
                                        onChange={(e) => setAgentResetPassword(e.target.value)}
                                      />
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          className={`${BTN_PRIMARY} !min-h-0 py-1.5 text-xs`}
                                          disabled={agentActionLoading}
                                          onClick={() => void submitAgentPasswordReset(row.tenant_id)}
                                        >
                                          Save
                                        </button>
                                        <button
                                          type="button"
                                          className={`${BTN_SECONDARY} !min-h-0 py-1.5 text-xs`}
                                          onClick={() => {
                                            setAgentActionTenantId(null);
                                            setAgentResetPassword("");
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                        {!platformLoading && platformTenants.length === 0 && (
                          <tr>
                            <td className="px-3 py-8 text-center text-zinc-500" colSpan={5}>
                              No agent accounts yet. Create one above.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                    </>
                  )}
                  {platformDeleteTarget && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
                      <div className={`${CARD_CLASS} w-full max-w-md space-y-4`}>
                        <h3 className="text-base font-semibold text-rose-300">Delete agent account permanently?</h3>
                        <p className="text-sm text-zinc-400">
                          This removes workspace <span className="font-medium text-zinc-200">{platformDeleteTarget.tenant_name}</span>,
                          the agent login, and all CRM data (contacts, messages, templates, campaigns, WhatsApp connections).
                          This cannot be undone.
                        </p>
                        <div className="space-y-1">
                          <label className="text-xs text-zinc-500">
                            Type <span className="font-mono text-zinc-300">{platformDeleteTarget.tenant_slug}</span> to confirm
                          </label>
                          <input
                            className={INPUT_CLASS}
                            value={platformDeleteConfirmSlug}
                            onChange={(e) => setPlatformDeleteConfirmSlug(e.target.value)}
                            placeholder={platformDeleteTarget.tenant_slug}
                            autoComplete="off"
                          />
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            className={BTN_SECONDARY}
                            disabled={platformDeleting}
                            onClick={() => {
                              setPlatformDeleteTarget(null);
                              setPlatformDeleteConfirmSlug("");
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className={`${BTN_ROW} border border-rose-500 bg-rose-600 text-white hover:bg-rose-500`}
                            disabled={platformDeleting}
                            onClick={() => void submitPlatformDelete()}
                          >
                            {platformDeleting ? "Deleting…" : "Delete workspace and data"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}
              {activeTab === "platform" && !isSuperAdmin && (
                <section className={`${CARD_CLASS} text-sm text-zinc-400`}>
                  Platform admin access is not enabled for your account. Set <code className="text-xs">SUPER_ADMIN_EMAILS</code>{" "}
                  on the API server and log in with a listed email.
                </section>
              )}
              {activeTab === "integrations" && (
                <section className="space-y-4">
                  <div className={`${CARD_CLASS} space-y-3 border-emerald-800/40`}>
                    <h3 className="text-base font-semibold text-emerald-200">AiSensy drop-in — no attendance CRM code change</h3>
                    <p className="text-sm text-zinc-400">
                      If your CRM already uses <code className="rounded bg-zinc-800 px-1 text-xs">AISENSY_API_URL</code> and{" "}
                      <code className="rounded bg-zinc-800 px-1 text-xs">AISENSY_API_KEY</code>, only change these values and create
                      matching live API campaigns in waservice. Same JSON: <code className="text-xs">campaignName</code>,{" "}
                      <code className="text-xs">destination</code>, <code className="text-xs">templateParams</code>.
                    </p>
                    <div className="rounded-xl border border-zinc-600 bg-black/40 p-3 font-mono text-[11px] text-zinc-300">
                      <p className="mb-2 font-sans text-xs font-semibold text-zinc-400">Attendance CRM .env</p>
                      <p>AISENSY_API_URL={typeof window !== "undefined" ? window.location.origin : "https://wa.paldigital.in"}/api/v1</p>
                      <p>AISENSY_API_KEY=wsk.&lt;id&gt;.&lt;secret&gt;</p>
                      <p className="mt-2 font-sans text-[10px] text-zinc-500">
                        Taskbook posts directly to that URL (no extra path). Alternate:{" "}
                        <code>{API_BASE}/campaign/t1/api/v2</code>
                      </p>
                    </div>
                    <p className="text-xs text-zinc-400">
                      <strong className="text-zinc-200">campaignName</strong> in the CRM must match a{" "}
                      <strong className="text-zinc-200">live</strong> API campaign name here, or the Meta template name (e.g.{" "}
                      <code className="text-xs">parent_attendance_auto_in_agra</code>). Create one live campaign per template in your CRM
                      settings.
                    </p>
                  </div>

                  <div className={`${CARD_CLASS} space-y-3`}>
                    <h3 className="text-base font-semibold text-zinc-100">External CRM — API campaign (Option A)</h3>
                    <p className="text-sm text-zinc-400">
                      Replace middleware like AiSensy: your CRM keeps its logic and calls waservice with an integration key. Each
                      automation uses one <strong className="text-zinc-200">live API campaign</strong> (fixed template + variable slots).
                    </p>
                    <ol className="list-inside list-decimal space-y-2 text-sm text-zinc-300">
                      <li>
                        <strong className="text-zinc-100">Templates</strong> — create body with{" "}
                        <code className="rounded bg-zinc-800 px-1 text-xs">{"{{1}}"}</code>, submit to Meta, sync when APPROVED.
                      </li>
                      <li>
                        <strong className="text-zinc-100">Campaigns</strong> — type API campaign → pick template → Create →{" "}
                        <strong className="text-zinc-100">Go Live</strong>.
                      </li>
                      <li>
                        <strong className="text-zinc-100">API keys</strong> — create a key below; your CRM sends header{" "}
                        <code className="rounded bg-zinc-800 px-1 text-xs">X-Integration-Key: wsk.&lt;id&gt;.&lt;secret&gt;</code>
                      </li>
                      <li>
                        <strong className="text-zinc-100">Trigger</strong> —{" "}
                        <code className="rounded bg-zinc-800 px-1 text-xs">POST /integrations/campaigns/&#123;campaign_id&#125;/trigger</code>{" "}
                        with phone + <code className="rounded bg-zinc-800 px-1 text-xs">body_parameters</code> in template order.
                      </li>
                    </ol>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={BTN_SECONDARY} onClick={() => setActiveTab("templates")}>
                        Open Templates
                      </button>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        onClick={() => {
                          setCampaignLaunchType("api");
                          setActiveTab("campaigns");
                        }}
                      >
                        Open API campaigns
                      </button>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Base URL for your CRM: <code className="text-zinc-300">{API_BASE}</code> · Worker must be running for queued sends.
                    </p>
                  </div>

                  <div className={`${CARD_CLASS} space-y-3`}>
                    <h3 className="text-base font-semibold text-zinc-100">Live API campaigns — copy for your CRM</h3>
                    {liveApiCampaigns.length === 0 ? (
                      <p className="text-sm text-zinc-500">
                        No live API campaigns yet. Create one under Campaigns (type API), click Go Live, then return here for the trigger
                        snippet.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {liveApiCampaigns.map((campaign) => (
                          <div key={campaign.id} className="rounded-xl border border-zinc-600 p-3">
                            <p className="font-medium text-zinc-100">{campaign.name}</p>
                            <ApiCampaignTriggerKit
                              campaignId={campaign.id}
                              campaignStatus={campaign.status}
                              templateName={campaign.template_name}
                              templateLanguage={campaign.template_language}
                              templateItems={templateItems}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {apiCampaigns.some((c) => c.status !== "live") && (
                      <p className="text-xs text-amber-200/90">
                        Draft API campaigns exist — set them to <strong>live</strong> on the Campaigns tab before your CRM can trigger them.
                      </p>
                    )}
                  </div>

                  <div className={`${CARD_CLASS} space-y-3`}>
                    <h3 className="text-base font-semibold text-zinc-100">Other endpoints (optional)</h3>
                    <p className="text-sm text-zinc-400">
                      Direct template send (no campaign ID) or session text inside the 24h window:
                    </p>
                    <div className="rounded-xl border border-zinc-600 bg-zinc-800/50/80 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
                      <p>
                        <span className="text-emerald-400">POST</span> {API_BASE}/integrations/whatsapp/send-template
                      </p>
                      <p>
                        <span className="text-emerald-400">POST</span> {API_BASE}/integrations/whatsapp/send-text
                      </p>
                      <p className="mt-2 font-sans text-[10px] text-zinc-500">
                        Option A (campaign trigger) is recommended when migrating from AiSensy-style automations.
                      </p>
                    </div>
                  </div>

                  <div className={`${CARD_CLASS} space-y-3`}>
                    <h3 className="text-base font-semibold text-zinc-100">Outbound webhooks (other CRM receives events)</h3>
                    <p className="text-sm text-zinc-400">
                      Optional. After Meta hits this app, a copy of the webhook is POSTed to your other CRM. Configure on the{" "}
                      <strong className="text-zinc-200">API server</strong> (not in the browser):{" "}
                      <code className="rounded bg-zinc-800 px-1 text-xs">EXTERNAL_CRM_WEBHOOK_URL</code> and optional{" "}
                      <code className="rounded bg-zinc-800 px-1 text-xs">EXTERNAL_CRM_WEBHOOK_SECRET</code>, then restart backend.
                      Meta callback URL stays the same — safe for live Wapaldigital.
                    </p>
                    {externalWebhookStatus?.configured ? (
                      <p className="text-sm text-emerald-400">
                        Forwarding enabled → {externalWebhookStatus.url_host}
                        {externalWebhookStatus.signing_enabled ? " (signed)" : ""}
                      </p>
                    ) : (
                      <p className="text-sm text-zinc-500">Forwarding not configured on this server.</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={BTN_SECONDARY} onClick={() => void loadExternalWebhookStatus(false)}>
                        Refresh status
                      </button>
                      <button
                        type="button"
                        className={BTN_PRIMARY_BLUE}
                        disabled={testingExternalWebhook || !externalWebhookStatus?.configured}
                        onClick={() => void testExternalCrmWebhook()}
                      >
                        {testingExternalWebhook ? (
                          <>
                            <Spinner /> Sending test…
                          </>
                        ) : (
                          "Send test event"
                        )}
                      </button>
                    </div>
                  </div>

                  <div className={`${CARD_CLASS} space-y-3`}>
                    <h3 className="text-base font-semibold text-zinc-100">API keys</h3>
                    <form onSubmit={createIntegrationKey} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[200px] flex-1">
                        <label className="mb-1 block text-xs font-medium text-zinc-400">Label (optional)</label>
                        <input
                          className={INPUT_CLASS}
                          placeholder="e.g. Production CRM"
                          value={newIntegrationLabel}
                          onChange={(e) => setNewIntegrationLabel(e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                      <button type="submit" className={BTN_PRIMARY_BLUE} disabled={creatingIntegrationKey || integrationKeysLoading}>
                        {creatingIntegrationKey ? (
                          <>
                            <Spinner /> Creating…
                          </>
                        ) : (
                          "Create key"
                        )}
                      </button>
                      <button
                        type="button"
                        className={BTN_SECONDARY}
                        disabled={integrationKeysLoading}
                        onClick={() => void loadIntegrationKeys(false)}
                      >
                        Reload list
                      </button>
                    </form>
                    {revealedIntegrationKey && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-3">
                        <p className="text-xs font-semibold text-amber-900">Copy this key now</p>
                        <p className="mt-1 break-all font-mono text-xs text-amber-950">{revealedIntegrationKey}</p>
                        <button
                          type="button"
                          className={`${BTN_SECONDARY} mt-2 !min-h-0 py-1.5 text-xs`}
                          onClick={() => void navigator.clipboard.writeText(revealedIntegrationKey).then(() => flash("integrationPanel", "Copied to clipboard.", "success"))}
                        >
                          Copy to clipboard
                        </button>
                      </div>
                    )}
                    <InlineFeedbackText feedback={inlineFeedback.integrationPanel} />
                    <div className="overflow-x-auto rounded-xl border border-zinc-600">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-zinc-800/50 text-zinc-400">
                          <tr>
                            <th className="px-3 py-2">Label</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Created</th>
                            <th className="px-3 py-2 w-28"> </th>
                          </tr>
                        </thead>
                        <tbody>
                          {integrationKeysLoading && integrationKeys.length === 0 ? (
                            <tr>
                              <td className="px-3 py-6 text-center text-zinc-500" colSpan={4}>
                                Loading keys…
                              </td>
                            </tr>
                          ) : (
                            integrationKeys.map((row) => (
                              <tr key={row.id} className="border-t border-zinc-700">
                                <td className="px-3 py-2">{row.label || "—"}</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                      row.is_active ? "bg-lime-500/20 text-lime-400" : "bg-zinc-700 text-zinc-400"
                                    }`}
                                  >
                                    {row.is_active ? "active" : "revoked"}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-zinc-400">{new Date(row.created_at).toLocaleString()}</td>
                                <td className="px-3 py-2 text-right">
                                  {row.is_active ? (
                                    <button
                                      type="button"
                                      className="text-xs font-semibold text-rose-700 hover:underline"
                                      onClick={() => void revokeIntegrationKey(row.id)}
                                    >
                                      Revoke
                                    </button>
                                  ) : (
                                    <span className="text-xs text-zinc-400">—</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                          {!integrationKeysLoading && integrationKeys.length === 0 && (
                            <tr>
                              <td className="px-3 py-6 text-center text-zinc-500" colSpan={4}>
                                No keys yet. Create one to authenticate external systems.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
