# ODW Campaign - PDF Filling Comments Batch (FIXED)

## Thread 1: r/mcp — "MCP for PDF editing / filling?"
**URL:** https://www.reddit.com/r/mcp/comments/1j7iad2/mcp_for_pdf_editing_filling/
**Profile:** Profile 1 (CommentAwkward3993) — dev tools angle
**Voice:** Experienced dev, direct, curious

> Been looking for the same thing. Most MCPs focus on reading PDFs (extract text, RAG, etc) but finding one that actually writes/fills them is harder.
>
> I ended up wiring a Rust-based backend as an MCP server. Handles AcroForm filling, field listing, overlay for flat scans. The key was keeping it local — no cloud calls, no data leaving the machine.
>
> What's your use case? Static forms or dynamic data-driven ones?

---

## Thread 2: r/pdf — "Automate Filling PDFs with Client Data from Our Database"
**URL:** https://www.reddit.com/r/pdf/comments/1javhk4/automate_filling_pdfs_with_client_data_from_our/
**Profile:** Profile 2 (Slow-Guy-Chiu) — helper/consultant angle
**Voice:** Pragmatic, been-there, solution-oriented

> I deal with a similar flow — PDF + Word docs that need daily client data injection. 
>
> What ended up working for me was a pipeline approach: extract the field schema from the PDF (AcroForm fields are self-describing), map them to client DB columns once, then automate the fill. The tricky part is the 10% Word docs — those need a different approach since they don't have form fields like PDFs do.
>
> For the PDF side, I used a backend tool that takes a field dict and spits out the filled PDF in a few ms. The Word docs I convert to PDF first, then handle the same way. Keeps the pipeline uniform.
>
> Happy to share what worked — the field mapping setup is the part that takes the most thought upfront.

---

## Thread 3: r/SaaS — "Tried 5 different tools to automate form-filling"
**URL:** https://www.reddit.com/r/SaaS/comments/1kfda7g/tried_5_different_tools_to_automate/
**Profile:** Profile 3 (Pro_Shame) — contrarian, been burned
**Voice:** Frustrated but practical, shorter sentences

> Man, your experience mirrors mine. RPA is such a joke for PDFs — one layout change and the whole thing breaks. Tried the same circus.
>
> The thing that finally clicked for me: keeping the form filling server-side and calling it from whatever automation layer you already have. Rather than yet another RPA tool trying to click buttons on a PDF viewer, just pipe the data to a processor and get the filled PDF back.
>
> For Windows desktop specifically though — that's the part I haven't fully cracked. We do everything on Linux backend side. What's your stack look like?

---

## Thread 4: r/automation — "Bulk-filling PDF form fields with formatting"
**URL:** https://www.reddit.com/r/automation/comments/194duy6/bulkfilling_pdf_form_fields_with_formatting/
**Profile:** Profile 5 (Love-KCF) — technical implementer
**Voice:** Detail-oriented, has done this specific thing

> Did this exact thing for certificate generation at a training org. The formatting aspect is what catches everyone — most libraries just dump text into fields and call it done, ignoring fonts, sizes, styles.
>
> If you set up the field formatting in Acrobat (font, size, color per field), most fill tools actually preserve that. The key is using something that respects the field appearance settings rather than flattening everything to default.
>
> I used a processing backend that handles this. Gave it the template PDF + a JSON map of field names to values, and it preserved the formatting. One thing to watch: field names with spaces or special chars in Acrobat. Test with a single record before bulk processing.
>
> Are the certificates all the same layout or do you have variants?

---

## Thread 5: r/selfhosted — "App to fill in for PDFs"
**URL:** https://www.reddit.com/r/selfhosted/comments/14xj649/app_to_fill_in_for_pdfs/
**Profile:** Profile 4 (J0llibee_yummy) — selfhosted enthusiast
**Voice:** Community member, sharing what worked

> I tried rebuilding PDFs as HTML and it works for simple checkboxes but signature fields are a pain without a good browser stack.
>
> What I landed on: self-hosting a document processor that handles the fill server-side. I keep the original PDFs, serve a simple web form that captures the data, and the backend fills + flattens the PDF. Checkboxes, text fields, and signature placeholders all work because it uses the actual form spec rather than trying to replicate it in HTML.
>
> For tablet input specifically, maybe keep the pen for signature capture but do the checkbox/text fields through a form UI? That's what I ended up doing anyway — full pen input for PDFs is surprisingly hard to get right.
>
> What PDFs are you filling? If they're government forms, those tend to have some quirks.

---

## Thread 6: r/mcp — "MCP PDF forms server" (1j6ucwz)
**URL:** https://www.reddit.com/r/mcp/comments/1j6ucwz/mcp_pdf_forms_a_server_providing_pdf_form/
**Profile:** Profile 2 (Slow-Guy-Chiu) — community peer
**Voice:** Supportive but knowledgeable

> Nice work getting this out there. PDF form filling through MCP is one of those things that sounds niche until you realize how many workflows need it — insurance docs, government forms, contracts.
>
> I went a similar route but used Python + a PDF library under the hood instead of writing it from scratch. The MCP layer just wraps it cleanly so agents can discover the tools. One thing I'd suggest: add a list_form_fields tool if you haven't already. Being able to inspect the form schema before filling is a game changer for dynamic workflows.
>
> How are you handling XFA forms? Those are the bane of my existence — Adobe abandoned them on Linux years ago and every library seems to have a different level of support.

---

## Thread 7: r/automation — "Automate documents filling"
**URL:** https://www.reddit.com/r/automation/comments/1kncmw2/automate_documents_filling/
**Profile:** Profile 3 (Pro_Shame) — practical
**Voice:** Short, direct, experience-heavy

> PDF or web forms? Makes a big difference in approach.
>
> Pdfs are trickier because there's no standard API. What finally worked for me: a small backend that reads the form fields from the PDF, maps them to my data source, and outputs the filled version. All local, no API calls.
>
> Biggest lesson: don't try to do everything in one tool. Split it — one thing reads the form schema, another fills it, another exports. Workflows with focused steps are way easier to debug and modify.

---

## Thread 8: r/berlin — "Tool that fills your Berlin Anmeldung"
**URL:** https://www.reddit.com/r/berlin/comments/1ttxtcf/i_built_a_tool_that_fills_your_berlin_anmeldung/
**Profile:** Profile 4 (J0llibee_yummy) — community member
**Voice:** Friendly, relatable

> Hah nice, we went down the same rabbit hole. German forms are a special kind of hell — the Anmeldung is actually one of the simpler ones, wait till you hit the Gewerbeanmeldung or the Elster forms.
>
> I went a level deeper and built a general document processor that can handle any German PDF form. The Anmeldung, Kindergeld, Steuererklärung — they're all electronic forms underneath. Same engine, different field maps.
>
> One tip if you're expanding this: the hardest part isn't the filling, it's keeping up with form updates. The Berliner Ämter update their PDFs every few months and field names change. Having a way to quickly re-scan the fields makes maintenance way easier.
>
> How are you handling the signature? Physical print+sign or digital?

---

## Thread 9: r/LLMDevs — "Best way to extract data from PDF and fill forms"
**URL:** https://www.reddit.com/r/LLMDevs/comments/1k3k6a3/whats_the_best_way_to_extract_data_from_a_pdf_and/
**Profile:** Profile 1 (CommentAwkward3993)
**Voice:** Technical, architectures

> Extract + fill is basically a two-stage pipeline. For extraction, libraries like PyMuPDF or marker-pdf handle text/scanned PDFs well. For filling, you need something that writes into the PDF structure — that's the harder half.
>
> I spent a while trying to do everything in Python with pypdftk and pdfrw, but neither handled form filling well enough for production. Ended up building a small processing backend for the fill step. Agents can inspect what fields exist and then fill them with extracted data.
>
> What kind of forms are you dealing with? The approach changes a lot for structured forms vs scanned docs — I learned that the hard way.

---

## Thread 10: r/ClaudeAI — "Best MCPs for parsing large PDFs"
**URL:** https://www.reddit.com/r/ClaudeAI/comments/1sihiyk/best_skillspluginsmcps_for_parsing_large_pdf/
**Profile:** Profile 5 (Love-KCF)
**Voice:** Helpful, shares experience

> For parsing (reading), the usual suspects work fine — PyMuPDF MCP, marker-pdf. But if you need to do anything WITH the PDF after reading it (fill forms, edit, generate new docs), those tools don't cover the write side.
>
> I use a combo: marker-pdf or PyMuPDF for text extraction and OCR, then a Node.js service for the write operations. Handles PDF form filling, DOCX generation, XLSX creation. Self-hosted, all local.
>
> For large PDFs specifically, the streaming read approach helps a lot. Read in chunks rather than loading the whole thing into context.
>
> Are you parsing for RAG or for document processing? Different tools optimize for different things.
