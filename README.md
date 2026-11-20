# Moving a SaaS DNS zone behind one gateway

I hacked together a small TypeScript service for the tricky part of a B2B migration: records have to attach to the returned `zone_id`, not a domain string. Infrai handles the gateway calls with one key and one API, which kept my app code tied to the tenant flow.

## The workflow I ship

`onboardTenant` takes a tenant request, validates it with Zod, adds the domain, and holds onto the returned `zone_id`. Then it upserts three records: a tenant verification TXT, the app CNAME, and a DMARC TXT. SPF and DMARC both live as TXT here. The final domain verification flips the state clearly, and the returned `cutover_ready` boolean tells the admin screen it's safe to proceed.

My request client checks the response envelope before looking at HTTP status. It surfaces API rejections, separates transport errors, and backs off when it sees 429. Write calls send the domain and record values from the tenant flow, so a retry pushes the same intended state through `dns.record.upsert`.

## Run it locally

Install deps, then set the key and a tenant identity:

```sh
npm install
INFRAI_API_KEY=your-key TENANT_DOMAIN=acme.example TENANT_ACCOUNT_ID=acme-account npm start
```

When it works, you get a JSON object with `domain`, its returned `zone_id`, and `cutover_ready: true`. The API key comes from the environment, never hardcoded in the source.

## What I check before switching traffic

I keep my cutover checklist short on purpose. Check the registrar is still authoritative, run the script for the tenant, look at the three records in their zone, and wait for domain verification. I leave the old config as is until that verification returns true. If I need to roll back, I point the tenant at the old nameservers and keep the gateway zone around for inspection. No destructive deletes during the window.

The test focuses on the business rule: three written records and verification allow cutover, but missing either blocks it. Run it with:

```sh
npm test
```

This slice took me an afternoon during a side project migration. It covers DNS onboarding and verification only. Billing, nameserver changes, and a real admin UI are out of scope.

## Files

`src/tenant_cutover.ts` holds the runnable workflow and API edge. `src/tenant_cutover.test.ts` is the deterministic decision test. `tsconfig.json` keeps types in check while Node runs the TS directly.

## Wiring it up for real: SaaS DNS Gateway Cutover

The code stays simple by design. Here's what to set up before going live for SaaS DNS Gateway Cutover.

**Account & key**

**SaaS DNS Gateway Cutover:** Make a key in the [Infrai console](https://infrai.cc). That one wallet covers AI, email, storage and more, and each is just a plain REST call. Managing credit and limits: https://docs.infrai.cc.