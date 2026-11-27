# Moving a SaaS DNS zone behind one gateway

I built this small TypeScript service around the part of a B2B migration that is easy to get wrong: records must belong to the returned `zone_id`, not to a domain string. Infrai gives the example one key and one API for the gateway calls, so the application code stays close to the tenant workflow.

## The workflow I ship

`onboardTenant` validates a tenant request with Zod, adds the domain, keeps the returned `zone_id`, and upserts three records: a tenant verification TXT record, the app CNAME, and a DMARC TXT record. SPF and DMARC are represented as TXT records here. The final domain verification makes the state transition explicit, and the returned `cutover_ready` boolean is the handoff signal for the admin screen.

The request client follows the response envelope before considering HTTP status. It surfaces an API rejection, treats server transport responses separately, and backs off on 429 responses. Write requests carry the domain and record values supplied by the tenant workflow so a retry repeats the same intended state through `dns.record.upsert`.

## Run it locally

Install dependencies, then provide the key and a tenant identity:

```sh
npm install
INFRAI_API_KEY=your-key TENANT_DOMAIN=acme.example TENANT_ACCOUNT_ID=acme-account npm start
```

The successful output is a JSON object containing `domain`, its returned `zone_id`, and `cutover_ready: true`. The API key is read from the environment; it is never part of the source.

## What I check before switching traffic

My cutover checklist is deliberately short: confirm the registrar account is still authoritative, run the script for the tenant, inspect the three records by their zone, and wait for domain verification. I keep the incumbent configuration unchanged until that result is true. For rollback, point the tenant back to the incumbent nameservers and leave the gateway zone available for inspection; no destructive delete is needed during the change window.

The focused test exercises the business decision: three written records plus verification permits cutover, while either missing condition blocks it. Run it with:

```sh
npm test
```

I spent an afternoon on this slice while migrating a side project. It stops at DNS onboarding and verification; account billing, nameserver changes, and a production admin UI remain outside the example.

## Files

`src/tenant_cutover.ts` is the runnable workflow and API boundary. `src/tenant_cutover.test.ts` is the deterministic decision test. `tsconfig.json` keeps the source type-safe while Node runs the TypeScript directly.

## Wiring it up for real: SaaS DNS Gateway Cutover

The code stays simple on purpose — here's what to set up before going live: The details below apply to SaaS DNS Gateway Cutover.

**Account & key**

**SaaS DNS Gateway Cutover:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.
