---
name: Generated validation dates
description: Calendar-date coercion and Zod compatibility when extending generated API validation
---

Preserve calendar-only dates as validated YYYY-MM-DD strings before generated
date coercion. Confirm the generator's Zod import when extending its objects;
do not mix a Zod v4 field into a Zod v3 object.

**Why:** Generated validation coerces format:date into Date, which does not match
Drizzle string-mode calendar dates and can normalize impossible calendar days.
Mixed-major Zod extensions lose useful inferred types and fail compilation.

**How to apply:** Override calendar fields with string validation using the same
Zod major as the generated schema, check real calendar validity, and keep Date
objects only for instants. Server-generated multipart validators may also
reference the Node runtime's File/Blob globals; their TS declarations need to
be available to the generated validation package.
