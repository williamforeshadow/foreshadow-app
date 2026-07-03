import { getSupabaseServer } from '@/lib/supabaseServer';

// Per-org PMS integrations (P3). Replaces the single global HOSTAWAY_* env vars
// with a per-org row in `pms_integrations`. Service-role only (the table holds
// secrets, RLS-enabled with no policies).
//
// Migration shim: org 1's seeded Hostaway row has EMPTY credentials, so creds
// fall back to the existing HOSTAWAY_* env vars until they're moved into the DB.
// Once every org stores its own creds, drop the env fallbacks below.

export type PmsProvider = 'hostaway' | 'hospitable';

export interface PmsIntegration {
  id: string;
  org_id: string;
  provider: PmsProvider;
  external_account_id: string | null;
  credentials: Record<string, unknown>;
  webhook_secret: string | null;
  status: 'active' | 'disabled' | 'error';
}

export interface HostawayCreds {
  accountId: string;
  clientSecret: string;
}

// Hospitable auth is a single Personal Access Token (Bearer). No env fallback —
// Hospitable integrations store their token in the DB from day one.
export interface HospitableCreds {
  token: string;
}

/** Active integrations for a provider (service-role). */
export async function listActiveIntegrations(provider: PmsProvider): Promise<PmsIntegration[]> {
  const { data, error } = await getSupabaseServer()
    .from('pms_integrations')
    .select('id, org_id, provider, external_account_id, credentials, webhook_secret, status')
    .eq('provider', provider)
    .eq('status', 'active');
  if (error) throw new Error(`pms_integrations lookup failed: ${error.message}`);
  return (data ?? []) as PmsIntegration[];
}

/** Find the integration whose webhook_secret matches, with env fallback to the
 *  env-backed Hostaway integration (org 1) when the secret matches HOSTAWAY_WEBHOOK_SECRET. */
export async function resolveHostawayIntegrationByWebhookSecret(
  secret: string,
): Promise<PmsIntegration | null> {
  const service = getSupabaseServer();
  const { data } = await service
    .from('pms_integrations')
    .select('id, org_id, provider, external_account_id, credentials, webhook_secret, status')
    .eq('provider', 'hostaway')
    .eq('webhook_secret', secret)
    .eq('status', 'active')
    .maybeSingle();
  if (data) return data as PmsIntegration;

  // Env-fallback: the org-1 row stores no webhook_secret and uses the env var.
  const envSecret = process.env.HOSTAWAY_WEBHOOK_SECRET;
  if (envSecret && secret === envSecret) {
    const { data: envBacked } = await service
      .from('pms_integrations')
      .select('id, org_id, provider, external_account_id, credentials, webhook_secret, status')
      .eq('provider', 'hostaway')
      .eq('status', 'active')
      .is('webhook_secret', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (envBacked as PmsIntegration | null) ?? null;
  }
  return null;
}

/** The single active Hostaway integration (there is one until a second Hostaway
 *  org onboards — org 2/Hospitable is a different provider). Used by the Hostaway
 *  cron paths; when multiple Hostaway orgs exist, loop over listActiveIntegrations
 *  instead. */
export async function getPrimaryHostawayIntegration(): Promise<PmsIntegration | null> {
  const active = await listActiveIntegrations('hostaway');
  return active[0] ?? null;
}

/** Resolve Hostaway creds for a specific org's integration (env fallback). */
export async function getHostawayCredsForOrg(orgId: string): Promise<HostawayCreds> {
  const { data } = await getSupabaseServer()
    .from('pms_integrations')
    .select('id, org_id, provider, external_account_id, credentials, webhook_secret, status')
    .eq('org_id', orgId)
    .eq('provider', 'hostaway')
    .eq('status', 'active')
    .maybeSingle();
  if (!data) throw new Error(`No active Hostaway integration for org ${orgId}`);
  return hostawayCredsFor(data as PmsIntegration);
}

/** Hostaway API creds for an integration, falling back to env for the seeded
 *  org-1 row whose credentials are empty. */
export function hostawayCredsFor(integ: PmsIntegration): HostawayCreds {
  const creds = integ.credentials ?? {};
  const accountId = (creds.account_id as string | undefined) ?? process.env.HOSTAWAY_ACCOUNT_ID;
  const clientSecret =
    (creds.client_secret as string | undefined) ?? process.env.HOSTAWAY_CLIENT_SECRET;
  if (!accountId || !clientSecret) {
    throw new Error(`Missing Hostaway credentials for integration ${integ.id} (org ${integ.org_id})`);
  }
  return { accountId, clientSecret };
}

// --- Hospitable -----------------------------------------------------------

/** The single active Hospitable integration (cron fan-out point). */
export async function getPrimaryHospitableIntegration(): Promise<PmsIntegration | null> {
  const active = await listActiveIntegrations('hospitable');
  return active[0] ?? null;
}

/** Hospitable Personal Access Token for an integration. */
export function hospitableCredsFor(integ: PmsIntegration): HospitableCreds {
  const token = (integ.credentials ?? {}).token as string | undefined;
  if (!token) {
    throw new Error(`Missing Hospitable token for integration ${integ.id} (org ${integ.org_id})`);
  }
  return { token };
}

/** Resolve Hospitable creds for a specific org's integration. */
export async function getHospitableCredsForOrg(orgId: string): Promise<HospitableCreds> {
  const { data } = await getSupabaseServer()
    .from('pms_integrations')
    .select('id, org_id, provider, external_account_id, credentials, webhook_secret, status')
    .eq('org_id', orgId)
    .eq('provider', 'hospitable')
    .eq('status', 'active')
    .maybeSingle();
  if (!data) throw new Error(`No active Hospitable integration for org ${orgId}`);
  return hospitableCredsFor(data as PmsIntegration);
}

/** Find the Hospitable integration whose webhook_secret matches (tenant routing).
 *  Hospitable webhooks carry no signature, so the per-integration URL secret is
 *  the tenant selector. */
export async function resolveHospitableIntegrationByWebhookSecret(
  secret: string,
): Promise<PmsIntegration | null> {
  const { data } = await getSupabaseServer()
    .from('pms_integrations')
    .select('id, org_id, provider, external_account_id, credentials, webhook_secret, status')
    .eq('provider', 'hospitable')
    .eq('webhook_secret', secret)
    .eq('status', 'active')
    .maybeSingle();
  return (data as PmsIntegration | null) ?? null;
}
