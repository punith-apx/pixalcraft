# PIXALCRAFT

A responsive, static agency site built with plain HTML, CSS and JavaScript. No build step or dependencies are required. The supplied PNGs in `~/Downloads` were visual references only; the site artwork and PC monogram are original SVG/CSS.

## Preview

Run from this directory with any static web server, for example:

```sh
python -m http.server 4173
```

Then open `http://localhost:4173`.

## Before publishing

- Edit `config.js` with the verified contact email and WhatsApp number. The contact form prepares a message but does not claim to send it until a destination is configured.
- Confirm all portfolio names and concept images are approved for publication; replace them with real case studies and destinations when client work is supplied.
- The production domain has not been confirmed. Before launch, replace `YOUR-DOMAIN-HERE` in `sitemap.xml`; add the absolute canonical URL, `og:url`, and absolute Open Graph and Twitter image URLs to `index.html`; and add the absolute sitemap URL to `robots.txt`. Use the same HTTPS host and preferred `www` or apex form for every URL.
- Configure the review backend below before accepting customer reviews. The contact enquiry is a separate form.

## Customer reviews backend

The customer review section uses Cloudflare Pages Functions and D1. Until the D1 binding, schema, and required secrets are configured, the review API returns an explicit error, the website does not display fabricated review data, and submissions are not reported as saved.

### Local development

`wrangler.toml` already contains the D1 database binding. For local Pages development, create a git-ignored `.dev.vars` file with non-production values for both required secrets:

```dotenv
REVIEWS_ADMIN_TOKEN=<a-long-random-local-token>
REVIEWS_RATE_LIMIT_SALT=<a-different-long-random-local-value>
```

Run `npx wrangler pages dev .`. Wrangler Pages loads `.dev.vars` automatically and uses a local D1 database; apply the migration locally with `npx wrangler d1 migrations apply pixalcraft-reviews --local` before testing submissions. Never copy local secret values into frontend files or commit `.dev.vars`. The root Pages output directory is `.`; `.assetsignore` excludes local secret files, project metadata, migrations, tests, and the source Functions from the public static asset manifest while Pages builds the Functions separately.

### Cloudflare Pages configuration

The production error `Review spam protection is not configured` means the Pages Function did not receive `REVIEWS_RATE_LIMIT_SALT`. Add that variable as a secret in the Cloudflare Pages project for the deployment environment receiving traffic (Production, and Preview too if previews accept reviews). Also set `REVIEWS_ADMIN_TOKEN` as a separate secret and ensure the `REVIEWS_DB` D1 binding is attached to the same Pages project. The local `.dev.vars` file does not configure Cloudflare.

The D1 database ID is already present in `wrangler.toml`; verify that it is the intended database before changing it. Apply `migrations/0001_create_reviews.sql` to the intended remote database through an explicitly authorized Cloudflare operation. This audit does not apply remote migrations or change production resources.

Public reviews load from `GET /api/reviews`; valid submissions go to `POST /api/reviews` and remain pending; the moderation page uses `GET` and `PATCH /api/admin/reviews`.

The public endpoint only returns approved records and calculates the average from those records. The submission endpoint validates and length-limits fields, uses a honeypot, and limits each hashed client IP to three submissions per hour. D1 stores the salted hash rather than the raw IP. The moderation endpoint requires the admin secret for both listing pending reviews and approving or rejecting a review. Rejected entries are retained in the database but never shown publicly.

Before launch, rotate any secrets if they may have been exposed, use HTTPS, and connect a Cloudflare Turnstile challenge if abuse requires stronger bot mitigation. Admin token access is not a replacement for Cloudflare account security.

For a complete deployment, use Pages Git integration or Wrangler from this project directory so the `/functions` routes are compiled along with the static site. The dashboard drag-and-drop upload does not compile Pages Functions. This project has no build step and uses `/` as its output directory. No Cloudflare project configuration or valid Git repository metadata is present in the workspace to verify a live deployment.
