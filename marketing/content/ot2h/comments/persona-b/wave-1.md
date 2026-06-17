# Persona B: Practical Builder — Wave 1 (25 comments)
**Voice:** Indie hacker / freelancer who ships fast. Pragmatic, results-oriented, cost-aware.
**Target subs:** r/SaaS, r/selfhosted, r/startups, r/webdev, r/sideproject
**90/10 rule:** 22 pure value + 3 soft-promo

---

## Pure Value Comments (22)

### 1. [r/SaaS] Replacing expensive document generation
**Context:** Someone asking how to cut SaaS costs for document/report generation.

I dropped three document generation SaaS tools last year. Replaced them with a self-hosted setup running on a $5 VPS. Cost went from $400/mo to almost nothing. Templates took a weekend to migrate but the savings are permanent.

### 2. [r/SaaS] MVP landing page testing
**Context:** Rapid A/B testing of landing pages for new features.

I generated 12 landing page variants in one afternoon last week. Just wrote the content differences, had them rendered automatically. Testing variations is the only way to know what converts and it used to take me all week. Now it's a few hours.

### 3. [r/SaaS] Reporting on a bootstrap budget
**Context:** Small SaaS needing internal analytics and client reports.

For internal dashboards I use a simple stack: Python script to pull data, render it as styled HTML, serve with nginx. Costs nothing extra and clients love getting branded reports. Not as fancy as PowerBI but covers 80% of reporting needs at 5% the cost.

### 4. [r/SaaS] Customer report automation
**Context:** Automating recurring client reports.

Set up automated weekly client reports using a cron job. Script pulls data, generates a formatted report, emails it out. Went from 2 hours of manual work to zero. Customers didn't notice the difference except reports arrive on time now.

### 5. [r/selfhosted] Self-hosted site builder
**Context:** Building and managing static websites without cloud dependencies.

I run my static site generator entirely self-hosted. Docker compose file, one template, content as markdown. Generates the full site in a few seconds. No cloud dependency, no monthly fees, and full control over the output. Can't beat that setup.

### 6. [r/selfhosted] Docker deployment patterns
**Context:** Simple reliable Docker deployments for personal projects.

Single Dockerfile with a multi-stage build pattern. Build stage compiles, runtime stage is a distroless image. Final image is about 85MB. Been running it for months with zero maintenance. Simple setups stay running.

### 7. [r/selfhosted] Landing page generation
**Context:** Quickly creating landing pages for side projects.

I use a template-based approach. Write the content as JSON, feed it through a renderer, get a styled page back. Takes about 30 seconds to spin up a new landing page. Perfect for testing ideas before committing to a full site build.

### 8. [r/startups] MVP documentation approach
**Context:** How to document early stage MVPs without overhead.

Skip the full docs. Write the one-page README and move on. I wasted weeks on documentation that nobody read at MVP stage. Now I write just enough for setup and basic usage. Fancy docs come after product-market fit.

### 9. [r/startups] Quick prototyping with templates
**Context:** Rapid prototyping tools and workflows.

Started keeping a library of reusable templates. Need a landing page? Grab the template, swap content, deploy. Cut my prototyping time from days to hours. Most of what we build follows common patterns anyway.

### 10. [r/webdev] HTML generation without browser overhead
**Context:** Generating HTML server-side without Playwright/Puppeteer.

I was using Puppeteer just to render some HTML templates. Total overkill for what I needed. Switched to a server-side renderer that doesn't need a headless browser. Cold start went from 3s to under a second. Sometimes the simple approach wins.

### 11. [r/webdev] Template system for client projects
**Context:** Reusing HTML/CSS templates across multiple client sites.

Built a shared template library for my freelance clients. One set of templates, different content per client. When I update the template all sites get the update. Cut my maintenance time by a lot. Clients appreciate consistent output too.

### 12. [r/webdev] Static site hosting options
**Context:** Cheap and reliable hosting for static websites.

I host static sites on a $5 DO droplet with nginx. Handles decent traffic, full control, and costs nothing. People overthink hosting. A basic VPS with a competent web server handles most use cases fine.

### 13. [r/sideproject] Building in public with reports
**Context:** Sharing progress on side projects with an audience.

I generate weekly progress reports for my side project's mailing list. Automation handles the formatting and distribution. Subscribers love seeing real numbers and progress. Takes me maybe 15 minutes of writing, the tooling does the rest.

### 14. [r/sideproject] CI/CD for static sites
**Context:** Automating deployment for personal projects.

Set up GitHub Actions to build and deploy my static site on every push. Commit markdown, get live site. Took an afternoon to configure, saves me mental context switching every time I want to publish something.

### 15. [r/selfhosted] Self-hosted alternatives strategy
**Context:** Identifying which SaaS tools to replace with self-hosted.

I apply a simple test: is this a core competency? If not, SaaS is fine. If it is, self-host it. Document generation was eating $200/mo and client data went through third parties. Moving it in-house was a no-brainer. Saved money and gave clients peace of mind.

### 16. [r/SaaS] Pricing page experiments
**Context:** Testing different pricing page layouts.

Generated three different pricing page layouts in an afternoon. Same content, different structure and CTAs. Ran them for two weeks and one variant converted 40% better. Small frontend changes make real money differences.

### 17. [r/SaaS] Email template system
**Context:** Managing transactional email templates for a SaaS.

I moved from inline email HTML to a template system. Define the layout once, the content fills in. Transactional emails, invoices, receipts all use the same base. Saved me from editing raw HTML in every email function.

### 18. [r/webdev] Markdown to HTML workflow
**Context:** Converting documentation and content from markdown to styled pages.

I write everything in markdown, convert to styled HTML for publishing. Keeps content and presentation separate. When I want to change the design I update the template, not every page. Much better than writing HTML directly.

### 19. [r/startups] Tool consolidation for small teams
**Context:** Reducing SaaS sprawl in early stage startups.

Audited our SaaS subscriptions last quarter. We had 14 tools doing overlapping things. Consolidated down to 6. Cut $800/mo and the team is happier with fewer context switches. Most startups over-buy tools before they know what they actually need.

### 20. [r/sideproject] Landing page first approach
**Context:** Validating ideas with a quick landing page before building.

My process is always landing page first. Spend an hour on a decent page, share it, see if anyone signs up. If nobody cares, move on. Saves building entire products that nobody wants. The landing page is the cheapest prototype you can make.

### 21. [r/selfhosted] Docker compose for small projects
**Context:** Docker Compose patterns for personal/hobby projects.

My standard Docker Compose setup for side projects is nginx + app + maybe a database. Three services, straightforward config. I template the compose file so I can spin up new projects fast. Keep it simple and it works.

### 22. [r/SaaS] Churn reduction with automated reporting
**Context:** Using automated reports to keep customers engaged.

Started sending automated monthly value reports to customers. Shows them what they built, how much they used it, what's new. Engagement went up and churn dropped. Takes zero ongoing effort once the template is set up.

---

## Soft-Promo Comments (3)

### 23. [r/SaaS] PROMO — HTML report generation
**Context:** Discussion about generating branded reports for SaaS customers.

I was spending way too long formatting customer reports. Found a self-hosted tool that takes my content and spits out styled HTML pages in under a second. Templates match my brand. Set it up once and now reports are fully automated.

### 24. [r/selfhosted] PROMO — Self-hosted HTML renderer
**Context:** Thread about self-hosted alternatives to cloud-based document services.

I run a self-hosted HTML generation server on a $5 VPS. It takes template + content, returns a complete styled page. No cloud APIs, no per-document costs. Generates everything from landing pages to client reports. Docker pull and done.

### 25. [r/webdev] PROMO — Template-based page generator
**Context:** Someone asking about efficient ways to generate HTML pages from structured data.

Been using a template-based approach with a headless renderer. Feed it JSON content, get back a complete styled HTML page. Works great for landing pages, reports, any structured output. Way faster than writing HTML by hand for each variant.
