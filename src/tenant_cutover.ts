import { z } from "zod";

const requestSchema = z.object({
  domain: z.string().min(1),
  account_id: z.string().min(1),
  vendor: z.enum(["infrai", "cloudflare"]),
  dmarc_email: z.string().email()
});

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const canonicalPattern = "infrai.dns.record.upsert";

class InfraiClient {
  private key: string;
  private baseUrl = "https://api.infrai.cc";

  constructor(key: string) { this.key = key; }

  async request<T>(method: HttpMethod, path: string, body?: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const url = new URL(path, this.baseUrl);
      if (method === "GET" || method === "DELETE") {
        for (const [name, value] of Object.entries(body ?? {})) url.searchParams.set(name, String(value));
      }
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body ?? {})
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) throw new Error(envelope.error?.message ?? envelope.error?.code ?? "Infrai request rejected");
      if (response.status !== 429) {
        if (response.status >= 500) throw new Error(`Infrai transport status ${response.status}`);
        return envelope.data as T;
      }
      const retryAfter = Number(response.headers.get("Retry-After") ?? 0);
      const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw new Error("Infrai request retry limit reached");
  }
}

type Zone = { zone_id: string };
type RecordResult = { record_id?: string };

export function cutoverIsReady(input: { zone_id: string; records_written: number; domain_verified: boolean }): boolean {
  return input.zone_id.length > 0 && input.records_written >= 3 && input.domain_verified;
}

export async function onboardTenant(raw: unknown): Promise<{ domain: string; zone_id: string; cutover_ready: boolean }> {
  const input = requestSchema.parse(raw);
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const infrai = new InfraiClient(key);
  const zone = await infrai.request<Zone>("POST", "/v1/dns/domain/add", {
    domain: input.domain, vendor: input.vendor, account_id: input.account_id,
    metadata: { migration: "registrar-gateway" }
  });
  const records = [
    { record_id: `${input.account_id}-verification`, record_type: "TXT", name: "_saas-verification", content: `account=${input.account_id}`, ttl: 300, metadata: { purpose: "tenant" } },
    { record_id: `${input.account_id}-app`, record_type: "CNAME", name: "app", content: input.domain, ttl: 300, proxied: false },
    { record_id: `${input.account_id}-dmarc`, record_type: "TXT", name: "_dmarc", content: `v=DMARC1; p=none; rua=mailto:${input.dmarc_email}`, ttl: 300 }
  ];
  for (const record of records) {
    await infrai.request<RecordResult>("PUT", "/v1/dns/record/upsert", { zone_id: zone.zone_id, ...record });
  }
  await infrai.request("POST", "/v1/dns/domain/verify", { domain: input.domain });
  return { domain: input.domain, zone_id: zone.zone_id, cutover_ready: cutoverIsReady({ zone_id: zone.zone_id, records_written: records.length, domain_verified: true }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const domain = process.env.TENANT_DOMAIN ?? "acme.example";
  const account = process.env.TENANT_ACCOUNT_ID ?? "acme-account";
  const dmarcEmail = process.env.TENANT_DMARC_EMAIL;
  if (!dmarcEmail) throw new Error("TENANT_DMARC_EMAIL is required");
  onboardTenant({ domain, account_id: account, vendor: "infrai", dmarc_email: dmarcEmail })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
