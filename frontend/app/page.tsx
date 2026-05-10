"use client";

import { useRouter } from "next/navigation";
import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Tag = {
  id: string;
  name: string;
  created_at: string;
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
};

type CampaignRecipient = {
  id: string;
  contact_id: string;
  state: string;
  created_at: string;
};

type Campaign = {
  id: string;
  name: string;
  message_text: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  recipients: CampaignRecipient[];
};

type TemplateItem = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  preview_text?: string | null;
};

type ConversationItem = {
  conversation_id: string;
  contact_id: string;
  contact_name: string | null;
  phone_e164: string;
  updated_at: string;
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

type DashboardSection = "contacts" | "campaigns" | "templates" | "inbox" | "settings" | "analytics" | "automations" | "integrations";
type PageMode = "root" | "auth" | "dashboard";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1";
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const CARD_CLASS = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
/** Compact table / toolbar actions */
const BTN_ROW =
  "inline-flex min-h-[2rem] min-w-[4.5rem] items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-55";
const BTN_PRIMARY =
  "inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55";
const BTN_PRIMARY_BLUE =
  "inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55";
const BTN_SUCCESS =
  "inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55";
const BTN_SECONDARY =
  "inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55";

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

function formatApiErrorBody(text: string, status: number): string {
  const trimmed = (text || "").trim();
  if (!trimmed) return "Something went wrong. Please try again.";
  if (trimmed.includes("Session has expired") || trimmed.includes('"code": 190') || trimmed.includes('"code":190') || trimmed.includes("OAuthException")) {
    return "Meta access token expired or invalid. Open Meta Developer Console → WhatsApp → API Setup, copy a fresh token, and save it in WhatsApp Settings.";
  }
  if (status === 429) return "Too many requests. Please wait a minute and try again.";
  if (status === 401) return "Session expired. Please log in again.";
  try {
    const parsed = JSON.parse(trimmed) as { detail?: unknown };
    if (typeof parsed.detail === "string") {
      const d = parsed.detail;
      if (d.includes("Session has expired") || d.includes("OAuthException")) {
        return "Meta access token expired or invalid. Paste a fresh token in WhatsApp Settings and save.";
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
  if (trimmed.length > 400) return trimmed.slice(0, 400) + "…";
  return trimmed;
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
    return `${base} bg-slate-200 text-slate-700 ring-slate-300/90`;
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
      ? "rounded bg-white/20 px-1 py-0.5 font-mono text-[0.92em] text-blue-50"
      : "rounded bg-slate-200/90 px-1 py-0.5 font-mono text-[0.92em] text-slate-900";

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
  | "sectionRefresh"
  | "tagCreate"
  | "tagRefresh"
  | "contactCreate"
  | "contactList"
  | "contactQuickSend"
  | "contactEdit"
  | "campaignCreate"
  | "campaignActions"
  | "templatesToolbar"
  | "templateCreate"
  | "integrationPanel"
  | "waConnectionForm"
  | "waTemplateTest"
  | "inboxReply"
  | "inboxList"
  | "inboxThread"
  | "metaPricing";

function InlineFeedbackText({ feedback, className = "" }: { feedback: InlineFeedback | undefined; className?: string }) {
  if (!feedback) return null;
  const tone = feedback.variant === "success" ? "text-emerald-800" : "text-rose-800";
  return (
    <p role="status" className={`mt-2 text-sm font-medium ${tone} ${className}`.trim()}>
      {feedback.text}
    </p>
  );
}

export default function HomePage() {
  return <AppClient mode="root" />;
}

export function AppClient({ mode = "dashboard", initialSection = "contacts" }: { mode?: PageMode; initialSection?: string }) {
  const router = useRouter();
  const normalizedInitialSection: DashboardSection = (
    ["contacts", "campaigns", "templates", "inbox", "settings", "analytics", "automations", "integrations"].includes(initialSection)
      ? initialSection
      : "contacts"
  ) as DashboardSection;
  const [token, setToken] = useState(() => (typeof window !== "undefined" ? window.localStorage.getItem("auth_token") || "" : ""));
  const [email, setEmail] = useState(() => (typeof window !== "undefined" ? window.localStorage.getItem("auth_email") || "" : ""));
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("Demo Tenant");
  const [tenantSlug, setTenantSlug] = useState("demo-tenant");
  const [tagName, setTagName] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [attributesInput, setAttributesInput] = useState("");
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAttributesInput, setEditAttributesInput] = useState("");
  const [editTagIds, setEditTagIds] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignName, setCampaignName] = useState("");
  const [campaignMessage, setCampaignMessage] = useState("");
  const [campaignContactIds, setCampaignContactIds] = useState<string[]>([]);
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
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationItem | null>(null);
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [inboxLastSyncedAt, setInboxLastSyncedAt] = useState<string>("");
  const [replyText, setReplyText] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [connectionHealth, setConnectionHealth] = useState<{
    overall: string;
    hints: string[];
    token_valid: boolean;
    waba_configured: boolean;
    webhook_ready: boolean;
    connection_configured: boolean;
  } | null>(null);
  const [quickSendContact, setQuickSendContact] = useState<Contact | null>(null);
  const [quickTemplateKey, setQuickTemplateKey] = useState("");
  const [inlineFeedback, setInlineFeedback] = useState<Partial<Record<FeedbackSlot, InlineFeedback>>>({});
  const feedbackTimersRef = useRef<Partial<Record<FeedbackSlot, number>>>({});
  const [sendingQuickTemplate, setSendingQuickTemplate] = useState(false);
  const [sendingTemplateTest, setSendingTemplateTest] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
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
  const [metaPricingLoading, setMetaPricingLoading] = useState(false);
  const [metaPricingData, setMetaPricingData] = useState<MetaPricingResponse | null>(null);
  const [metaPricingGranularity, setMetaPricingGranularity] = useState<"DAILY" | "HALF_HOUR" | "MONTHLY">("DAILY");
  const [metaPricingDays, setMetaPricingDays] = useState<7 | 30>(30);
  const [metaPricingCountryFilter, setMetaPricingCountryFilter] = useState("");

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
    }
  };

  useEffect(() => {
    setHydrated(true);
  }, []);

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

  useEffect(() => {
    if (email) {
      window.localStorage.setItem("auth_email", email);
    }
  }, [email]);

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
      throw new Error(formatApiErrorBody(text, response.status));
    }
    return (await response.json()) as T;
  }

  async function apiRequestNoContent(path: string, options: RequestInit = {}): Promise<void> {
    const response = await fetch(`${API_BASE}${path}`, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(formatApiErrorBody(text, response.status));
    }
  }

  async function handleRegister(event: FormEvent) {
    event.preventDefault();
    try {
      const data = await apiRequest<{ access_token: string }>("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          tenant_name: tenantName,
          tenant_slug: tenantSlug
        })
      });
      setToken(data.access_token);
      router.push("/dashboard/contacts");
    } catch (error) {
      flash("authRegister", (error as Error).message, "error");
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
      router.push("/dashboard/contacts");
    } catch (error) {
      flash("authLogin", (error as Error).message, "error");
    }
  }

  async function loadTags(resultSlot?: FeedbackSlot) {
    try {
      const data = await apiRequest<Tag[]>("/crm/tags", { headers: authHeaders });
      setTags(data);
      if (resultSlot) flash(resultSlot, "Tags updated.", "success");
    } catch (error) {
      if (resultSlot) flash(resultSlot, (error as Error).message, "error");
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
      setContacts(data);
      if (resultSlot && !quiet) flash(resultSlot, "Contacts list updated.", "success");
    } catch (error) {
      if (resultSlot && !quiet) flash(resultSlot, (error as Error).message, "error");
    }
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

  async function filterContacts(event: FormEvent) {
    event.preventDefault();
    try {
      const data = await apiRequest<Contact[]>("/crm/contacts/filter", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          query: searchQuery || null,
          tag_ids: []
        })
      });
      setContacts(data);
      flash("contactList", "Filter applied.", "success");
    } catch (error) {
      flash("contactList", (error as Error).message, "error");
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
    if (!campaignName.trim() || !campaignMessage.trim()) return;
    try {
      await apiRequest<Campaign>("/campaigns", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: campaignName,
          message_text: campaignMessage || `Template: ${waTemplateName || "not-selected"} (${waTemplateLanguage})`,
          contact_ids: campaignContactIds
        })
      });
      setCampaignName("");
      setCampaignMessage("");
      setCampaignContactIds([]);
      await loadCampaigns();
      flash("campaignCreate", "Campaign created.", "success");
    } catch (error) {
      flash("campaignCreate", (error as Error).message, "error");
    }
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

  async function loadConnectionHealth() {
    try {
      const q = waConnectionId ? `?connection_id=${encodeURIComponent(waConnectionId)}` : "";
      const data = await apiRequest<{
        overall: string;
        hints: string[];
        token_valid: boolean;
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
    const sep = quickTemplateKey.indexOf("__");
    const name = sep >= 0 ? quickTemplateKey.slice(0, sep) : quickTemplateKey;
    const lang = sep >= 0 ? quickTemplateKey.slice(sep + 2) : "en_US";
    setSendingQuickTemplate(true);
    try {
      await apiRequest<{ message_id?: string }>("/whatsapp/send-template-test", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          connection_id: waConnectionId || null,
          to_phone_e164: quickSendContact.phone_e164,
          template_name: name,
          language_code: lang
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

  useEffect(() => {
    if (!token) return;
    if (activeTab === "contacts") {
      loadTags();
      loadContacts();
      loadTemplates();
      return;
    }
    if (activeTab === "campaigns") {
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
      loadConversations();
      return;
    }
    if (activeTab === "analytics") {
      loadCampaigns();
      loadContacts();
      loadTemplates(undefined, true);
      return;
    }
    if (activeTab === "integrations") {
      void loadIntegrationKeys(true);
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTab]);

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
        loadContacts(undefined, true),
        loadCampaigns(undefined, true),
        loadTemplates(undefined, true),
        loadConversations(undefined, true)
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

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selectedConversation || !replyText.trim()) return;
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
    setToken("");
    router.push("/login");
  }

  const showAuth = mode === "auth" || !token;
  const isRedirecting = !hydrated || mode === "root" || (mode === "dashboard" && !token);

  if (isRedirecting) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-blue-50 p-6">
        <div className="mx-auto max-w-7xl">
          <section className={`${CARD_CLASS} flex items-center justify-center py-16`}>
            <p className="text-sm text-slate-500">Loading...</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-blue-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">WhatsApp SaaS CRM</h1>
            <p className="text-xs text-slate-500">API base: {API_BASE}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${token ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              {token ? "Authenticated" : "Not Authenticated"}
            </span>
            {token && (
              <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50" onClick={handleLogout}>
                Logout
              </button>
            )}
          </div>
        </header>

        {showAuth ? (
          <section className="mx-auto grid max-w-5xl gap-6 rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-md md:grid-cols-2">
            <form onSubmit={handleLogin} className={`${CARD_CLASS} space-y-3 bg-slate-50/60`}>
              <h2 className="text-lg font-semibold text-slate-900">Welcome back</h2>
              <p className="text-xs text-slate-500">Sign in to access contacts, campaigns and message logs.</p>
              <input className={INPUT_CLASS} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className={INPUT_CLASS} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800" type="submit">
                Login
              </button>
              <InlineFeedbackText feedback={inlineFeedback.authLogin} />
            </form>

            <form onSubmit={handleRegister} className={`${CARD_CLASS} space-y-3 border-blue-200 bg-blue-50/40`}>
              <h2 className="text-lg font-semibold text-slate-900">Create workspace</h2>
              <p className="text-xs text-slate-500">First-time setup for your tenant account.</p>
              <input className={INPUT_CLASS} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className={INPUT_CLASS} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <input className={INPUT_CLASS} placeholder="Tenant Name" value={tenantName} onChange={(e) => setTenantName(e.target.value)} />
              <input className={INPUT_CLASS} placeholder="Tenant Slug (example: acme-team)" value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} />
              <button className="w-full rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700" type="submit">
                Register
              </button>
              <InlineFeedbackText feedback={inlineFeedback.authRegister} />
            </form>
          </section>
        ) : (
          <>
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                <p className="text-xs text-slate-500">
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
                  <p className="text-xs font-medium text-slate-500">Contacts</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{contacts.length}</p>
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">CRM records</p>
                </div>
                <div className={`${CARD_CLASS} ${!statsSnapshotLoaded && statsSnapshotRefreshing ? "animate-pulse" : ""}`}>
                  <p className="text-xs font-medium text-slate-500">Open conversations</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{conversations.length}</p>
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">Inbox threads</p>
                </div>
                <div className={`${CARD_CLASS} ${!statsSnapshotLoaded && statsSnapshotRefreshing ? "animate-pulse" : ""}`}>
                  <p className="text-xs font-medium text-slate-500">Templates</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{templateItems.length}</p>
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">
                    {approvedTemplateCount} approved
                  </p>
                </div>
                <div className={`${CARD_CLASS} ${!statsSnapshotLoaded && statsSnapshotRefreshing ? "animate-pulse" : ""}`}>
                  <p className="text-xs font-medium text-slate-500">Running campaigns</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{campaignStats.running}</p>
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">Active broadcasts</p>
                </div>
                <div className={`${CARD_CLASS} ${!statsSnapshotLoaded && statsSnapshotRefreshing ? "animate-pulse" : ""}`}>
                  <p className="text-xs font-medium text-slate-500">Recipients sent</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{campaignStats.sent}</p>
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">Across all campaigns</p>
                </div>
                <div className={`${CARD_CLASS} ${!statsSnapshotLoaded && statsSnapshotRefreshing ? "animate-pulse" : ""}`}>
                  <p className="text-xs font-medium text-slate-500">Recipients failed</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-rose-700">{campaignStats.failed}</p>
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">Needs attention</p>
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-[240px,1fr]">
              <aside className={`${CARD_CLASS} h-fit space-y-2 lg:sticky lg:top-6`}>
                <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Workspace</p>
                {[
                  ["contacts", "Contacts", "CRM"],
                  ["campaigns", "Campaigns", "Broadcast"],
                  ["templates", "Templates", "Meta"],
                  ["inbox", "Inbox", "Live Chat"]
                ].map(([key, label, hint]) => (
                  <button
                    key={key}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium ${
                      activeTab === key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                    }`}
                    onClick={() => {
                      const next = key as DashboardSection;
                      setActiveTab(next);
                      router.push(`/dashboard/${next}`);
                    }}
                  >
                    <div>{label}</div>
                    <div className={`text-xs ${activeTab === key ? "text-slate-300" : "text-slate-400"}`}>{hint}</div>
                  </button>
                ))}
                <p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Admin</p>
                {[
                  ["settings", "WhatsApp Settings", "Connections"],
                  ["analytics", "Analytics", "Reports"],
                  ["automations", "Automations", "Flows"],
                  ["integrations", "Integrations", "External Apps"]
                ].map(([key, label, hint]) => (
                  <button
                    key={key}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm font-medium ${
                      activeTab === key ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                    }`}
                    onClick={() => {
                      const next = key as DashboardSection;
                      setActiveTab(next);
                      router.push(`/dashboard/${next}`);
                    }}
                  >
                    <div>{label}</div>
                    <div className={`text-xs ${activeTab === key ? "text-slate-300" : "text-slate-400"}`}>{hint}</div>
                  </button>
                ))}
              </aside>

              <div className="space-y-4">
            <section className={`${CARD_CLASS} flex flex-wrap items-center justify-between gap-3`}>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{sectionMeta[activeTab].title}</h2>
                <p className="text-sm text-slate-500">{sectionMeta[activeTab].subtitle}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="hidden text-xs text-slate-400 sm:inline">
                    {statsUpdatedAt ? `Data as of ${statsUpdatedAt.toLocaleTimeString()}` : ""}
                  </span>
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
                </div>
                <InlineFeedbackText feedback={inlineFeedback.sectionRefresh} className="text-right" />
              </div>
            </section>
            {activeTab === "contacts" && (
              <>
                <section className="grid gap-4 lg:grid-cols-2">
                  <div className={`${CARD_CLASS} space-y-3`}>
                    <h2 className="text-base font-semibold text-slate-900">Tags</h2>
                    <form onSubmit={createTag} className="space-y-2">
                      <div className="flex gap-2">
                        <input className={INPUT_CLASS} placeholder="Tag name" value={tagName} onChange={(e) => setTagName(e.target.value)} />
                        <button className="rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700" type="submit">
                          Add
                        </button>
                      </div>
                      <InlineFeedbackText feedback={inlineFeedback.tagCreate} />
                    </form>
                    <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50" type="button" onClick={() => loadTags("tagRefresh")}>
                      Refresh Tags
                    </button>
                    <InlineFeedbackText feedback={inlineFeedback.tagRefresh} />
                    <div className="flex flex-wrap gap-2">
                      {tags.length === 0 ? (
                        <p className="text-sm text-slate-500">No tags yet</p>
                      ) : (
                        tags.map((tag) => (
                          <span key={tag.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                            {tag.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className={`${CARD_CLASS} space-y-3`}>
                    <h2 className="text-base font-semibold text-slate-900">Create Contact</h2>
                    <form onSubmit={createContact} className="space-y-2">
                      <input className={INPUT_CLASS} placeholder="Name (optional)" value={contactName} onChange={(e) => setContactName(e.target.value)} />
                      <input className={INPUT_CLASS} placeholder="9999999999 (auto +91)" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                      <input className={INPUT_CLASS} placeholder="Attributes (city:Mumbai,source:ads)" value={attributesInput} onChange={(e) => setAttributesInput(e.target.value)} />
                      <select
                        multiple
                        className={`${INPUT_CLASS} h-28`}
                        value={selectedTagIds}
                        onChange={(e) => {
                          const values = Array.from(e.target.selectedOptions).map((opt) => opt.value);
                          setSelectedTagIds(values);
                        }}
                      >
                        {tags.map((tag) => (
                          <option key={tag.id} value={tag.id}>
                            {tag.name}
                          </option>
                        ))}
                      </select>
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
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50" type="button" onClick={() => loadContacts("contactList")}>
                      Load Contacts
                    </button>
                    <form onSubmit={filterContacts} className="flex flex-wrap gap-2">
                      <input className={INPUT_CLASS} placeholder="Search name/phone" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                      <button className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-900" type="submit">
                        Filter
                      </button>
                    </form>
                    <InlineFeedbackText feedback={inlineFeedback.contactList} />
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Phone</th>
                          <th className="px-3 py-2">Tags</th>
                          <th className="px-3 py-2">Attributes</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contacts.map((contact) => (
                          <tr key={contact.id} className="border-t border-slate-100">
                            <td className="px-3 py-2">{contact.name || "-"}</td>
                            <td className="px-3 py-2">{contact.phone_e164}</td>
                            <td className="px-3 py-2">{contact.tags.map((tag) => tag.name).join(", ") || "-"}</td>
                            <td className="px-3 py-2">{Object.entries(contact.custom_attributes || {}).map(([k, v]) => `${k}:${String(v)}`).join(", ") || "-"}</td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className={`${BTN_ROW} border border-slate-200 bg-white text-slate-800 hover:bg-slate-50`}
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
                        ))}
                        {contacts.length === 0 && (
                          <tr>
                            <td className="px-3 py-4 text-center text-slate-500" colSpan={5}>
                              No contacts found
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                {quickSendContact && (
                  <section className={`${CARD_CLASS} space-y-3 border border-emerald-100`}>
                    <h2 className="text-base font-semibold text-slate-900">Send template to contact</h2>
                    <p className="text-sm text-slate-600">
                      Recipient: <span className="font-medium text-slate-900">{quickSendContact.name || "Unnamed"}</span> — {quickSendContact.phone_e164}
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
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Message preview</p>
                              <p className="whitespace-pre-wrap text-sm text-slate-800">{sel.preview_text.trim()}</p>
                            </div>
                          );
                        })()}
                        <p className="text-xs text-slate-500">Uses the same Meta flow as “Send Template Test” in Settings (approved template required).</p>
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
                    <h2 className="text-base font-semibold text-slate-900">Edit Contact</h2>
                    <form onSubmit={updateContact} className="grid gap-2 md:grid-cols-2">
                      <input className={INPUT_CLASS} placeholder="Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                      <input className={INPUT_CLASS} placeholder="9999999999 (auto +91)" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                      <input className={`${INPUT_CLASS} md:col-span-2`} placeholder="Attributes (city:Mumbai,source:ads)" value={editAttributesInput} onChange={(e) => setEditAttributesInput(e.target.value)} />
                      <select
                        multiple
                        className={`${INPUT_CLASS} h-28 md:col-span-2`}
                        value={editTagIds}
                        onChange={(e) => setEditTagIds(Array.from(e.target.selectedOptions).map((opt) => opt.value))}
                      >
                        {tags.map((tag) => (
                          <option key={tag.id} value={tag.id}>
                            {tag.name}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2 md:col-span-2">
                        <button className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700" type="submit">
                          Save
                        </button>
                        <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50" type="button" onClick={clearEditForm}>
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
              <section className="grid gap-4 lg:grid-cols-2">
                <div className={`${CARD_CLASS} space-y-3`}>
                  <h2 className="text-base font-semibold text-slate-900">Create Campaign</h2>
                  <form onSubmit={createCampaign} className="space-y-2">
                    <input className={INPUT_CLASS} placeholder="Campaign name" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
                    <textarea className={INPUT_CLASS} placeholder="Campaign message text" value={campaignMessage} onChange={(e) => setCampaignMessage(e.target.value)} rows={4} />
                    <div className="grid gap-2 md:grid-cols-2">
                      <select
                        className={INPUT_CLASS}
                        value={waTemplateName}
                        onChange={(e) => {
                          const selected = templateItems.find((item) => item.name === e.target.value);
                          setWaTemplateName(e.target.value);
                          if (selected) setWaTemplateLanguage(selected.language);
                        }}
                      >
                        <option value="">Select template</option>
                        {templateItems.map((item) => (
                          <option key={`${item.name}:${item.language}`} value={item.name}>
                            {item.name} ({item.language})
                          </option>
                        ))}
                      </select>
                      <input className={INPUT_CLASS} placeholder="Template language" value={waTemplateLanguage} onChange={(e) => setWaTemplateLanguage(e.target.value)} />
                    </div>
                    <select
                      multiple
                      className={`${INPUT_CLASS} h-36`}
                      value={campaignContactIds}
                      onChange={(e) => setCampaignContactIds(Array.from(e.target.selectedOptions).map((opt) => opt.value))}
                    >
                      {contacts.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {(contact.name || "Unnamed")} - {contact.phone_e164}
                        </option>
                      ))}
                    </select>
                    <button className="rounded-xl bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700" type="submit">
                      Create Campaign
                    </button>
                    <InlineFeedbackText feedback={inlineFeedback.campaignCreate} />
                  </form>
                </div>

                <div className={`${CARD_CLASS} space-y-3`}>
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-900">Campaigns</h2>
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex gap-2">
                        <button
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                          type="button"
                          onClick={() => loadTemplates("campaignActions")}
                        >
                          Load Templates
                        </button>
                        <button
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
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
                      <div key={campaign.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-slate-900">{campaign.name}</p>
                          <span className={`rounded-full px-2 py-1 text-xs ${campaign.status === "running" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                            {campaign.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">{campaign.message_text}</p>
                        <p className="mt-2 text-xs text-slate-500">Recipients: {campaign.recipients.length}</p>
                        <button
                          className="mt-2 rounded-lg border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => startCampaign(campaign.id)}
                          disabled={campaign.status === "running"}
                        >
                          {campaign.status === "running" ? "Running" : "Start"}
                        </button>
                      </div>
                    ))}
                    {campaigns.length === 0 && <p className="text-sm text-slate-500">No campaigns yet</p>}
                  </div>
                </div>
              </section>
            )}

            {activeTab === "settings" && (
              <>
                <section className={`${CARD_CLASS} space-y-3`}>
                  <h2 className="text-base font-semibold text-slate-900">Setup checklist</h2>
                  <p className="text-xs text-slate-500">Complete these steps for a reliable WhatsApp CRM setup.</p>
                  <ul className="space-y-2 text-sm text-slate-700">
                    <li className="flex items-center gap-2">
                      <span className={waConnectionId && waPhoneNumberId.trim() ? "text-emerald-600" : "text-slate-400"}>
                        {waConnectionId && waPhoneNumberId.trim() ? "✓" : "○"}
                      </span>
                      Connection saved (phone number id)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={waWabaId.trim() ? "text-emerald-600" : "text-slate-400"}>{waWabaId.trim() ? "✓" : "○"}</span>
                      WABA ID set (for template sync)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={waVerifyTokenConfigured ? "text-emerald-600" : "text-slate-400"}>{waVerifyTokenConfigured ? "✓" : "○"}</span>
                      Verify token set (Meta webhook)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={waAppSecretConfigured ? "text-emerald-600" : "text-slate-400"}>{waAppSecretConfigured ? "✓" : "○"}</span>
                      App secret set (secure inbound webhooks)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={templateItems.length > 0 ? "text-emerald-600" : "text-slate-400"}>{templateItems.length > 0 ? "✓" : "○"}</span>
                      Templates synced ({templateItems.length} in library)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className={connectionHealth?.overall === "healthy" ? "text-emerald-600" : "text-slate-400"}>
                        {connectionHealth?.overall === "healthy" ? "✓" : "○"}
                      </span>
                      API health check passed (token + webhook readiness)
                    </li>
                  </ul>
                </section>

                <section className="grid gap-4 lg:grid-cols-2">
                <div className={`${CARD_CLASS} space-y-3`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-slate-900">Meta WhatsApp Connection</h2>
                      {connectionHealth && (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            connectionHealth.overall === "healthy"
                              ? "bg-emerald-100 text-emerald-800"
                              : connectionHealth.overall === "disconnected"
                                ? "bg-slate-200 text-slate-700"
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
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        onClick={() => loadConnectionHealth()}
                      >
                        Re-check
                      </button>
                    </div>
                    <div className="flex gap-2">
                        <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50" type="button" onClick={() => loadWhatsAppConnection("waConnectionForm")}>
                          Load Default
                        </button>
                        <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50" type="button" onClick={() => loadWhatsAppConnections("waConnectionForm")}>
                          List All
                        </button>
                    </div>
                  </div>
                  {connectionHealth && connectionHealth.overall !== "healthy" && connectionHealth.hints.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
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
                      <label className="text-xs font-medium text-slate-600">Connection Label</label>
                      <input className={INPUT_CLASS} placeholder="Primary" value={waLabel} onChange={(e) => setWaLabel(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Phone Number ID</label>
                      <input className={INPUT_CLASS} placeholder="Meta phone number id" value={waPhoneNumberId} onChange={(e) => setWaPhoneNumberId(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">WABA ID</label>
                      <input className={INPUT_CLASS} placeholder="WhatsApp Business Account ID" value={waWabaId} onChange={(e) => setWaWabaId(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Access Token</label>
                      <input
                        className={INPUT_CLASS}
                        placeholder={waAccessTokenPreview ? "Saved securely. Enter only to rotate token" : "Paste fresh Meta access token"}
                        value={waAccessToken}
                        onChange={(e) => setWaAccessToken(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Verify Token</label>
                      <input
                        className={INPUT_CLASS}
                        placeholder={waVerifyTokenConfigured ? "Saved securely. Enter only to rotate verify token" : "Your custom webhook verify token"}
                        value={waVerifyToken}
                        onChange={(e) => setWaVerifyToken(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">App Secret</label>
                      <input
                        className={INPUT_CLASS}
                        placeholder={waAppSecretConfigured ? "Saved securely. Enter only to rotate app secret" : "Meta app secret"}
                        value={waAppSecret}
                        onChange={(e) => setWaAppSecret(e.target.value)}
                      />
                    </div>
                    {waAccessTokenPreview && (
                      <p className="text-xs text-slate-500">
                        Saved token: {waAccessTokenPreview} {waAppSecretConfigured ? "| App secret configured" : "| App secret not set"}
                      </p>
                    )}
                    <div className="flex gap-4 text-sm text-slate-700">
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
                  <h2 className="text-base font-semibold text-slate-900">Send Template Test</h2>
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
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Message preview</p>
                          <p className="whitespace-pre-wrap text-sm text-slate-800">{sel.preview_text.trim()}</p>
                        </div>
                      );
                    })()}
                    <p className="text-xs text-slate-500">Selected language: {waTemplateLanguage || "en_US"}</p>
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
                  <p className="text-xs text-slate-500">
                    Test requires an approved template in Meta and recipient allowed in your WhatsApp setup.
                  </p>
                </div>

              </section>
              </>
            )}

            {activeTab === "templates" && (
              <section className="space-y-4">
                <div className={`${CARD_CLASS} space-y-3`}>
                  <h2 className="text-base font-semibold text-slate-900">Create template in Meta</h2>
                  <p className="text-xs text-slate-500">
                    Sends a TEXT header/body/footer template for approval using your logged-in account's default WhatsApp connection.
                    Numbered placeholders like{" "}
                    <code className="rounded bg-slate-100 px-1">{"{{1}}"}</code> are converted to named variables for Meta (
                    <code className="rounded bg-slate-100 px-1">{"{{your_label}}"}</code>
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
                    <code className="rounded bg-slate-100 px-1">template.components[].parameters[]</code> with{" "}
                    <code className="rounded bg-slate-100 px-1">parameter_name</code> +{" "}
                    <code className="rounded bg-slate-100 px-1">text</code> for each variable (see Meta&apos;s named-parameter send
                    examples). This app&apos;s simple &quot;Send template test&quot; call does not pass those parameters yet—utility
                    templates without variables, or extending the send API, are needed for tests.
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
                        <label className="block text-xs font-medium text-slate-600">Language</label>
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
                        <label className="block text-xs font-medium text-slate-600">Category</label>
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
                      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                        <p className="text-xs font-medium text-slate-700">Template variables</p>
                        <p className="text-xs text-slate-500">
                          For each <code className="rounded bg-white px-1">{"{{n}}"}</code>, choose a Meta variable name (lowercase,
                          underscores) and a sample value Meta uses during review.
                        </p>
                        <ul className="space-y-2">
                          {createTplPhOrder.map((n, i) => (
                            <li key={`${n}-${i}`} className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
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
                                <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
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
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={createTplAllowCat}
                        onChange={(e) => setCreateTplAllowCat(e.target.checked)}
                        className="rounded border-slate-300"
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
                    <h2 className="text-base font-semibold text-slate-900">Template library</h2>
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex gap-2">
                        <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50" type="button" onClick={() => loadTemplates("templatesToolbar")}>
                          Load
                        </button>
                        <button
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
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
                      <div key={item.id} className="rounded-xl border border-slate-200 p-3">
                        <p className="text-sm font-semibold">{item.name}</p>
                        <p className="text-xs text-slate-500">{item.language}</p>
                        <p className="text-xs text-slate-500">{item.category || "No category"}</p>
                        <span className={templateStatusBadgeClass(item.status)}>
                          {item.status || "unknown"}
                        </span>
                      </div>
                    ))}
                    {templateItems.length === 0 && <p className="text-sm text-slate-500">No templates loaded yet.</p>}
                  </div>
                </div>
              </section>
            )}

            {activeTab === "inbox" && (
              <section className="grid gap-4 lg:grid-cols-2">
                <div className={`${CARD_CLASS} space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">Inbox Conversations</h2>
                      <p className="text-xs text-slate-500">
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" /> Live auto-refresh
                        {inboxLastSyncedAt ? ` | Last sync: ${inboxLastSyncedAt}` : ""}
                      </p>
                    </div>
                    <button className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50" type="button" onClick={() => loadConversations("inboxList")}>
                      Refresh
                    </button>
                  </div>
                  <InlineFeedbackText feedback={inlineFeedback.inboxList} />
                  <div className="max-h-80 space-y-2 overflow-auto">
                    {conversations.map((item) => (
                      <button
                        key={item.conversation_id}
                        className={`w-full rounded-xl border p-3 text-left ${
                          selectedConversation?.conversation_id === item.conversation_id ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"
                        }`}
                        onClick={() => loadConversationMessages(item)}
                      >
                        <p className="text-sm font-medium">{item.contact_name || "Unknown contact"}</p>
                        <p className="text-xs text-slate-500">{item.phone_e164}</p>
                      </button>
                    ))}
                    {conversations.length === 0 && <p className="text-sm text-slate-500">No conversations yet</p>}
                  </div>
                </div>

                <div className={`${CARD_CLASS} space-y-3`}>
                  <h2 className="text-base font-semibold text-slate-900">Conversation Thread</h2>
                  <InlineFeedbackText feedback={inlineFeedback.inboxThread} />
                  <div className="max-h-72 space-y-2 overflow-auto rounded-xl border border-slate-200 p-3">
                    {conversationMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                          msg.direction === "outbound" ? "ml-auto bg-blue-600 text-white" : "bg-slate-100 text-slate-800"
                        }`}
                      >
                        <div className="text-[15px]">
                          {formatWhatsAppRichText(
                            getMessageDisplayText(msg.payload as Record<string, unknown> | undefined, msg.type),
                            msg.direction === "outbound" ? "outbound" : "inbound"
                          )}
                        </div>
                        <p className={`mt-1 text-[10px] ${msg.direction === "outbound" ? "text-blue-100" : "text-slate-500"}`}>
                          {msg.status}
                        </p>
                      </div>
                    ))}
                    {conversationMessages.length === 0 && <p className="text-sm text-slate-500">Select a conversation</p>}
                  </div>
                  <form onSubmit={sendReply} className="space-y-2">
                    <textarea className={INPUT_CLASS} rows={3} placeholder="Type reply..." value={replyText} onChange={(e) => setReplyText(e.target.value)} />
                    <button className={BTN_PRIMARY} type="submit" disabled={!selectedConversation || sendingReply || !replyText.trim()}>
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
                    <h2 className="text-base font-semibold text-slate-900">Campaign performance</h2>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-xl border border-slate-200 p-3">
                        <p className="text-xs text-slate-500">Total Campaigns</p>
                        <p className="text-xl font-semibold text-slate-900">{campaigns.length}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-3">
                        <p className="text-xs text-slate-500">Scheduled</p>
                        <p className="text-xl font-semibold text-indigo-700">{campaignStats.scheduled}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-3">
                        <p className="text-xs text-slate-500">Completed</p>
                        <p className="text-xl font-semibold text-emerald-700">{campaignStats.completed}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-3">
                        <p className="text-xs text-slate-500">Pending / Queued</p>
                        <p className="text-xl font-semibold text-amber-700">{campaignStats.queued}</p>
                      </div>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-3 py-2">Campaign</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Recipients</th>
                            <th className="px-3 py-2">Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaigns.map((campaign) => (
                            <tr key={campaign.id} className="border-t border-slate-100">
                              <td className="px-3 py-2">{campaign.name}</td>
                              <td className="px-3 py-2">{campaign.status}</td>
                              <td className="px-3 py-2">{campaign.recipients.length}</td>
                              <td className="px-3 py-2">{new Date(campaign.updated_at).toLocaleString()}</td>
                            </tr>
                          ))}
                          {campaigns.length === 0 && (
                            <tr>
                              <td className="px-3 py-4 text-center text-slate-500" colSpan={4}>
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
                        <h2 className="text-base font-semibold text-slate-900">Meta spend (pricing analytics)</h2>
                        <p className="mt-1 text-sm text-slate-600">
                          Pulled from Meta&apos;s <code className="rounded bg-slate-100 px-1 text-xs">pricing_analytics</code> for your
                          WABA. Costs are shown in <span className="font-medium text-slate-800">Indian Rupees (INR)</span>; period labels
                          use <span className="font-medium text-slate-800">IST (Asia/Kolkata)</span>. Official totals: Meta Billing Hub.
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

                    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Range</label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                              metaPricingDays === 7 ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"
                            }`}
                            onClick={() => setMetaPricingDays(7)}
                          >
                            Last 7 days
                          </button>
                          <button
                            type="button"
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                              metaPricingDays === 30 ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"
                            }`}
                            onClick={() => setMetaPricingDays(30)}
                          >
                            Last 30 days
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Granularity</label>
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
                        <label className="mb-1 block text-xs font-medium text-slate-600">Countries (optional)</label>
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
                        <p className="text-xs text-slate-500">{metaPricingData.disclaimer}</p>
                        <p className="text-xs text-slate-500">
                          WABA <span className="font-mono">{metaPricingData.waba_id}</span>
                          {metaPricingData.connection_label ? ` · Connection: ${metaPricingData.connection_label}` : ""}
                          <br />
                          Fetched {formatMetaFetchedAtIso(metaPricingData.fetched_at)} IST · Range{" "}
                          {formatMetaRangeDateFromUnix(metaPricingData.start_ts)} – {formatMetaRangeDateFromUnix(metaPricingData.end_ts)}{" "}
                          (IST) · {metaPricingData.granularity}
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="text-xs font-medium text-slate-500">Approx. total cost (sum of buckets)</p>
                            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                              {formatMetaInr(metaPricingData.summary_total_cost)}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-400">Indian Rupees (INR)</p>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="text-xs font-medium text-slate-500">Delivered volume (summed)</p>
                            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{metaPricingData.summary_total_volume}</p>
                            <p className="mt-1 text-[11px] text-slate-400">Message delivery counts in returned rows</p>
                          </div>
                        </div>

                        {metaPricingByCategory.length > 0 && (
                          <div className="rounded-xl border border-slate-200">
                            <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                              By pricing category
                            </p>
                            <table className="min-w-full text-left text-sm">
                              <thead className="bg-slate-50/80 text-slate-600">
                                <tr>
                                  <th className="px-3 py-2">Category</th>
                                  <th className="px-3 py-2">Cost</th>
                                  <th className="px-3 py-2">Volume</th>
                                </tr>
                              </thead>
                              <tbody>
                                {metaPricingByCategory.map(([cat, agg]) => (
                                  <tr key={cat} className="border-t border-slate-100">
                                    <td className="px-3 py-2 font-medium">{cat}</td>
                                    <td className="px-3 py-2 tabular-nums">{formatMetaInr(agg.cost)}</td>
                                    <td className="px-3 py-2 tabular-nums">{agg.volume}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
                          <table className="min-w-full text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-slate-600">
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
                                <tr key={`${row.start}-${row.end}-${idx}`} className="border-t border-slate-100">
                                  <td className="px-3 py-2 text-slate-600">
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
                      <p className="text-sm text-slate-500">Choose a range and click Load from Meta to fetch pricing analytics.</p>
                    )}
                  </section>
                </>
              )}
              {activeTab === "automations" && (
                <section className={`${CARD_CLASS} space-y-2`}>
                  <h2 className="text-base font-semibold text-slate-900">Automations</h2>
                  <p className="text-sm text-slate-600">
                    Rule-based flows, triggers, and sequences will live here. The workspace metrics above stay in sync when you use{" "}
                    <span className="font-medium text-slate-800">Refresh workspace data</span>.
                  </p>
                </section>
              )}
              {activeTab === "integrations" && (
                <section className="space-y-4">
                  <div className={`${CARD_CLASS} space-y-3`}>
                    <h3 className="text-base font-semibold text-slate-900">Server-to-server API</h3>
                    <p className="text-sm text-slate-600">
                      Other systems send WhatsApp messages with an integration key (header <code className="rounded bg-slate-100 px-1 text-xs">X-Integration-Key</code>
                      ). Keys are tied to this tenant and use the default WhatsApp connection.
                    </p>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 font-mono text-[11px] leading-relaxed text-slate-700">
                      <p className="mb-2 font-sans text-xs font-semibold text-slate-600">Endpoints (same base as the app)</p>
                      <p>
                        <span className="text-emerald-700">POST</span> {API_BASE}/integrations/whatsapp/send-template
                      </p>
                      <p>
                        <span className="text-emerald-700">POST</span> {API_BASE}/integrations/whatsapp/send-text
                      </p>
                      <p className="mt-2 font-sans text-[10px] text-slate-500">
                        JSON body fields match the dashboard API (template name, language, optional body_parameters; or plain text for session messages).
                      </p>
                    </div>
                  </div>

                  <div className={`${CARD_CLASS} space-y-3`}>
                    <h3 className="text-base font-semibold text-slate-900">API keys</h3>
                    <form onSubmit={createIntegrationKey} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[200px] flex-1">
                        <label className="mb-1 block text-xs font-medium text-slate-600">Label (optional)</label>
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
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-600">
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
                              <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
                                Loading keys…
                              </td>
                            </tr>
                          ) : (
                            integrationKeys.map((row) => (
                              <tr key={row.id} className="border-t border-slate-100">
                                <td className="px-3 py-2">{row.label || "—"}</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                      row.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"
                                    }`}
                                  >
                                    {row.is_active ? "active" : "revoked"}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-slate-600">{new Date(row.created_at).toLocaleString()}</td>
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
                                    <span className="text-xs text-slate-400">—</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                          {!integrationKeysLoading && integrationKeys.length === 0 && (
                            <tr>
                              <td className="px-3 py-6 text-center text-slate-500" colSpan={4}>
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
