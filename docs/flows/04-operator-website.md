# Flow 04: Operator website (one page, 2–3 styles)

**PRD:** MKT-08 (_"A one-page operator site generated from products, in two or three styles with
colour and font themes and light or dark mode"_) and MKT-09 (_"Preview any style with real content;
switching keeps all content and booking links"_, a "Should").

The site is **generated**: the operator doesn't build pages, they pick a style. All content comes from
their products and a few business details.

---

## Guest side: the one-page site · `/irin-lagos-tours` (or the operator's own domain, later)

**Sections, top to bottom (suggested):**

1. **Header:** business name / logo, a **Book** button
2. **Hero:** a tagline ("Walk Lagos with people who love it"), a photo or a pattern, a primary
   call to action
3. **Tours:** cards (as in the catalogue, flow 01 screen A): title, summary, duration, from price,
   next date, Book
4. **About:** a short paragraph about the business
5. **Why book with us:** 3 short points (free cancellation up to 48 h, small groups, local guides…)
6. **FAQs:** general questions (product FAQs live on each tour page)
7. **Contact:** WhatsApp button, phone, email, address, social links
8. **Footer:** booking terms, cancellation policy, privacy, "Bookings by OkapiGo"

**Booking from the site** uses the same tour page and checkout (flow 01), in the same style.

**States:** no published tours ("New tours coming soon"); missing optional content (no photo, no
about text: the section hides, the page still looks finished).

## The styles

Please design **2 or 3 styles** as **token sets** (see the README): different personality, same
structure. For example:

| Style       | Feel                                        |
| ----------- | ------------------------------------------- |
| **Classic** | calm, editorial, serif headings             |
| **Bold**    | bright colour blocks, large type, energetic |
| **Earth**   | warm, natural colours, rounded shapes       |

Each style needs **light and dark** variants. The operator picks the style and the mode; a
**brand colour** override per operator would be a bonus.

---

## Operator side: choosing a style (in the operator app)

**Shows:** the styles as **live previews with the operator's real content** (MKT-09), not stock
images; a light/dark toggle; **Apply**.

**Rules:** switching style changes **only the look**. Content, tour links and booking links stay
exactly the same (shared links never break).

**Also needed: business details** (new fields, I'll add them): tagline, about text, WhatsApp number,
phone, email, address, social links, logo, hero photo. Design a simple form for these.

**❓ For you:**

- Photos and the logo: uploads arrive with media storage (session 18). Design so everything looks
  finished **without** any images first.
- The PRD's full website builder is v1. Keep this to one page; resist adding pages.
