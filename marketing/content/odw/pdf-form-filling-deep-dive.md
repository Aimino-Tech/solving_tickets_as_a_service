# Content Angle: PDF Form Filling — AcroForm, XFA, and Scanned Overlays

**Target platforms**: Reddit (existing PDF-filling comments extended), X (thread), HN (technical comment)

## Core Narrative

PDF form filling in Rust requires supporting three completely different form technologies — AcroForm (the old standard), XFA (the XML-based Adobe standard), and scanned overlays (image + coordinates). Most libraries only handle one.

## Key Technical Details

- **AcroForm**: Annotation-based forms. Fields defined in the PDF's interactive form dictionary. Most common, most compatible.
- **XFA (XML Forms Architecture)**: XML-based forms embedded in PDF. More powerful but deprecated by Adobe PDF 2.0. Still required for many government/enterprise PDFs.
- **Scanned overlays**: No form fields at all. Place text at x,y coordinates over a scanned image. Requires OCR + coordinate mapping.
- **Implementation approach**: Three separate format backends, unified API: `fill_form(pdf, fields: Vec<Field>) -> Result<Pdf>`.

## Platform Drafts

### X Thread (5 tweets)

> T1: I spent 3 days debugging a segfault in our Rust PDF parser. The cause? XFA form with a recursive field reference that blew the stack.
>
> T2: PDF forms come in 3 flavors: AcroForm (standard), XFA (XML-based), and scanned overlays (image + coordinates). Each requires completely different handling.
>
> T3: AcroForm: read the annotation tree, map field names to values, write back. Straightforward.
>
> T4: XFA: XML DOM inside the PDF. You need to parse the XDP packet, traverse the form template, and serialize back. Adobe deprecated it but governments still use it.
>
> T5: Scanned overlays: no form fields at all. Just place text at coordinates over an image. This is what most "PDF auto-fill" actually needs.
>
> T6: All three supported in our open-source MCP server. MIT licensed. [link]

### Reddit Follow-up (extending existing PDF-filling comments pipeline)

> **Context**: This expands the existing content at `marketing/content/odw-pdf-filling-comments.md`
>
> Actually supporting PDF forms in production means handling three completely different form technologies:
>
> 1. **AcroForm** — the standard PDF form spec. This is what libraries like iText and pdf-lib handle. Annotations with field dictionaries. Works great — if the PDF was created with proper AcroForm support.
>
> 2. **XFA** — the XML-based form standard. Adobe's original vision for PDF 2.0, now deprecated, but still used by US government forms, EU procurement, and Japanese tax documents. The form lives as XML inside the PDF. Libraries like pdf-lib can't touch it. You need an XML parser that navigates the XDP packet structure.
>
> 3. **Scanned overlays** — no form fields. Someone printed a form, filled it with a pen, scanned it. Now you need to overlay text at pixel coordinates on top of a raster image. This is technically not "form filling" — it's compositing. But from the user's perspective, they need the same result: data in the right fields.
>
> Our Rust MCP server handles all three. Writing the XFA parser from scratch was the hardest — the spec is huge, deprecated, and the only real documentation is Adobe's old XML schema files.
>
> We open-sourced the whole thing. npm: @aimino/opendocswork-mcp.

### LinkedIn Post

> PDF form filling is harder than it sounds. Here's why:
>
> There are 3 completely different form technologies inside PDF files:
> - AcroForm: the standard (but many PDFs implement it wrong)
> - XFA: XML-based (deprecated but still everywhere in government)
> - Scanned overlays: no form fields at all
>
> Most PDF libraries handle one. Maybe two if you're lucky.
>
> We built all three into office-oxide-mcp. The XFA parser alone took weeks — the spec is abandoned by Adobe but still required for processing USA, EU, and JP government documents.
>
> It's all open source. MIT licensed.
>
> Link in comments.

---

## Visual Assets Needed

1. Side-by-side: AcroForm vs XFA vs Scanned overlay — XML structure comparison
2. Flow: Input file → format detection → form filling → output across 3 paths
3. Screenshot: Same form filled via all 3 methods, visual comparison

**Format**: PNG for X, integrated into existing Reddit content pipeline
