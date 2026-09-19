# Landing integration

## Route ownership

One Next.js application serves both the public presentation and operator panel:

| URL          | Owner                                  | Behavior                                               |
| ------------ | -------------------------------------- | ------------------------------------------------------ |
| `/`          | `src/app/(marketing)/page.tsx`         | Far0 landing, rendered without operator data           |
| `/dashboard` | `src/app/(console)/dashboard/page.tsx` | Existing operator map and event log                    |
| `/landing`   | `next.config.ts`                       | Permanent redirect to `/`, preserving query parameters |
| `/api/*`     | `src/app/api/`                         | Existing API and SSE routes                            |

The landing's three dashboard links use `/dashboard` in the same tab with
prefetching disabled. The operator header provides a home link. Direct visits,
refreshes and bookmarked `/dashboard` URLs work without visiting the landing.
The home page stays visible until the visitor chooses to open the dashboard.
In production, `/dashboard` opens directly during the configured 26-hour public
demo window, without a login, code or cookie. Outside that window it shows a closed
page. The public landing is unchanged. Development keeps direct dashboard access. See
[deployment access configuration](vercel-deployment.md).

## Layout and CSS isolation

The original dashboard stylesheet defines global element selectors and a light
palette, while the landing uses a dark background and `.lp` styles. Each route
group owns its root layout, Tailwind entry point and metadata. There is no shared
top-level root layout. Next.js performs full document navigation across the
groups, discarding the previous page's styles and client state.

This avoids rewriting the operator stylesheet or overriding it from the landing.
Backend state is unaffected by navigation; dashboard polling and SSE reconnect
when the operator page mounts. The landing imports no map, operator hooks or
backend modules and requires no database or provider credentials.

Do not move either stylesheet into a shared root layout without reviewing the
global selectors. Keep future operator pages in `(console)` and public pages in
`(marketing)`. The parentheses do not become part of public URLs.

## Source and maintenance

Imported from [Luissantra/far0-landing](https://github.com/Luissantra/far0-landing)
at commit [`44503c8`](https://github.com/Luissantra/far0-landing/commit/44503c8cd5611a5e31127f38d16e5d192d7294b7).
The existing MIT copyright notice matches the source and remains in `LICENSE`.

- Landing page, layout, CSS and favicon: `src/app/(marketing)/`.
- Logo and animation component: `src/components/landing/`, with filenames
  adapted to this repository's kebab-case convention.
- Original logos and media: `public/brand/` and `public/media/`, copied unchanged.
- Three external configurable dashboard CTAs become internal Next.js links.

The approved English copy, intro dolly, partner strip, manual simulated response,
reduced-motion behavior, poster fallback and keyboard controls are retained.
The illustration sends no messages. Media is pre-rendered; Blender and FFmpeg are
not required to run the integrated app. Render sources and the detailed visual
history remain in the source repository.

This is a source import, not a runtime dependency, submodule or automatic sync.
Future landing changes require a reviewed port. Do not merge the standalone
package configuration or lockfile into this app: use the destination's existing
Next.js, React, Tailwind and npm setup.

## Configuration and deployment

Deploy the existing repository as one Next.js app. No extra hosting, proxy,
cross-origin configuration or dependency is required.

`DASHBOARD_URL` is not used here. `NEXT_PUBLIC_SITE_URL` optionally defines the
landing metadata origin; `VERCEL_PROJECT_PRODUCTION_URL` is the fallback on
Vercel and `http://localhost:3000` is the local fallback. `REPOSITORY_URL`
optionally enables the footer source-code link. These values are public and
resolved at build time; rebuild after changing them. API authentication and
provider configuration remain governed by their existing documentation.

## Local review

Run `npm run check` using Node 24.x. The hackathon check excludes automated tests.
Inspect the production routes after `npm run build` and `npm start`:

1. `/` shows the landing and three `/dashboard` links, without operator content.
2. `/dashboard` loads directly and includes a home link.
3. `/landing` returns a permanent redirect to `/`.
4. Logos, posters and both videos resolve; videos support byte-range requests.
5. Landing metadata describes the product and canonical home; dashboard metadata
   describes the operator sketch.

Browser review should additionally cover navigation in both directions and
browser Back, desktop/mobile styling, reduced motion, keyboard access, the
simulated response and dashboard data loading. Do not infer that browser
interactions passed from a successful build or HTTP check.
