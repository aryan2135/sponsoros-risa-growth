# Presentation Final QA Report

**Deliverables verified:**
- `deliverables/RISA_Growth_Strategy.pptx` (editable 3-slide PowerPoint, generated via `deliverables/build/make_deck.js`)
- `deliverables/RISA_Growth_Strategy.pdf` (exported directly via Microsoft PowerPoint 16.0)
- `PRODUCT_LINK.txt` (live demo URL and GitHub repository URL; no credentials included)
- `README.md` (updated deliverables table and deployment section with live demo URL and final deck links)

---

## 1. Corrections Applied

### Slide 1 — How High Can We Aim?
1. **Sponsor ICP payment criterion:** Replaced `"will pay a 50% advance"` with `"ability to approve milestone-based payment terms"`.
2. **2025 cash mix & share:** Replaced `"renewals 83% (20 of 24 were cash)"` with `"Cash-type mix: 20/24 partnerships (83%); cash share of confirmed value: 89% (₹20.0L/₹22.4L)"` (from `outputs/audit/audit_snapshot.json`: 20 cash-type of 24 confirmed partnerships; ₹20,00,000 / ₹22,40,000 = 89.3%).
3. **84% collection rate framing:** Explicitly labelled `"Collection 84% [forward assumption—no 2025 receipt records]"` so it is clearly distinguished as a forward-looking assumption rather than historical evidence.
4. **Gross vs. net forecast cash:** Clarified in the headline, hero KPI card, and assumptions card that `₹35.0L` is forecast gross cash receipts (`₹34,95,807` exact) and `₹31.9L` is net (`₹31,87,990` exact) after `₹3.08L` acquisition costs (`₹2,15,000` initiative budgets + `₹40,000` closer stipend + `₹52,817` creator finder fees = `₹3,07,817`).
5. **Funnel column & bridge labels:** Changed `"Cash collected"` in the funnel table header to `"Forecast pre-festival cash"` and updated the final waterfall bar label to `"Forecast gross cash"`.
6. **Cohort totals reconciliation:** Reconciled all funnel rows and totals against unrounded model outputs in `outputs/model/forecast_summary.json` (see Section 2 below).
7. **Campaign conversion chart denominator:** Made the denominator explicit as **unique brands touched** (`Confirmed ÷ unique brands touched (num/den)`) and added exact `(numerator/denominator)` labels on every bar from `outputs/audit/campaign_reconciliation.csv`: Cold email `(0/91)` = 0%, Warm intros `(8/8)` = 100%, LinkedIn `(0/37)` = 0%, Inbound form `(7/17)` = 41%, Creator refs `(9/19)` = 47%, Revival `(0/20)` = 0%.
8. **Monte Carlo band label:** Labelled `P10–P90 ₹25.7L–₹44.8L` as `"assumption-driven MC range, 10k runs; not empirical CI"`.
9. **No forecast-as-verified-cash wording:** Replaced `"₹35.0L of verified cash"` in the headline with `"₹35.0L in forecast cash receipts before the festival"`, changed `"Base · verified cash pre-festival"` to `"Base · forecast gross cash pre-festival"`, and updated Slide 2's bridge title to `"Bridge: BAU → base plan (₹ lakh, forecast gross cash)"`.

### Slide 2 — Where Will We Place Our Bets?
1. **Headline:** Updated to `"Five ranked initiatives add ₹26.2L; cutting cold outreach removes ₹0.5L, yielding ₹25.7L net uplift over BAU for ₹3.08L all-in. Fund cash collection and renewals first."`
2. **Double Down clarity:** Clarified that `I1 (Collection Desk)` improves cash collection across all signed cash commitments (70%→84%) for `₹15K`, while `I2 (Renewal Sprint)` generates `+₹6.5L` in additional sponsorship revenue from 2025 sponsors and seeds `I4` referrers.
3. **Model & ROI verification:** Verified all five initiative increments, ordered waterfall steps, budgets (`₹2.15L`), closer stipend (`₹40K`), 8% finder fee (`₹52.8K` base), total cost (`₹3.08L`), and net cash ROI (`₹25.67L / ₹3.08L = 8.3×`, updated display from `≈ ₹8` to `≈ ₹8.3` per `₹1` all-in).

### Slide 3 — How Will We Know What's Working?
1. **Simulated vs. historical distinction:** Replaced `"Already firing on the 2025 data..."` with `"Retrospective SponsorOS rule simulation on the 2025 snapshot: 20 cash-type commitments flagged for payment-schedule follow-up; cold campaigns STOP, creator referrals SCALE. These are simulated recommendations, not historical actions or issued invoices."`
2. **Live Demo hyperlink:** Added one understated, clickable hyperlink near the bottom left (`Explore SponsorOS — Live Demo ↗` → `https://sponsoros-risa-growth.onrender.com`) with no QR code, card, extra graphics, or repeated footer links.

---

## 2. Reconciled Cohort & Waterfall Numbers (`outputs/model/forecast_summary.json`)

### Slide 1 Funnel Table Reconciliation (Base Case)

| Source | Prospects | Conversations (exact → 1dp) | Proposals (exact → 1dp) | Signed EV (exact → 1dp) | Avg Deal | Forecast Pre-Festival Cash (exact → ₹L) |
|---|---:|---:|---:|---:|---:|---:|
| 2025 sponsor renewals | 24 (`24.0`) | `21.60` → `21.6` | `18.36` → `18.4` | `10.10` → `10.1` | ₹125K | `₹9,00,514` → `₹9.0L` |
| Qualified, not pitched | 18 (`18.0`) | `12.60` → `12.6` | `9.45` → `9.5` | `4.25` → `4.3` | ₹95K | `₹3,14,918` → `₹3.1L` |
| Inbound partner page | 27 (`26.6`) | `19.95` → `20.0` | `12.97` → `13.0` | `7.13` → `7.1` | ₹105K | `₹5,79,446` → `₹5.8L` |
| Alumni & sponsor refs | 43 (`42.75`) | `32.06` → `32.1` | `20.84` → `20.8` | `11.46` → `11.5` | ₹115K | `₹10,13,664` → `₹10.1L` |
| Creator / community | 33 (`33.25`) | `24.94` → `24.9` | `16.21` → `16.2` | `8.92` → `8.9` | ₹95K | `₹6,60,209` → `₹6.6L` |
| Cold ABM test | 40 (`40.0`) | `8.00` → `8.0` | `4.80` → `4.8` | `0.38` → `0.4` | ₹90K | `₹27,057` → `₹0.3L` |
| **Sum of displayed rows** | **185** | **119.2** | **82.7** | **42.3** | — | **₹34.9L** |
| **Unrounded model total** | **184.6 → 185** | **119.15 → 119.2** | **82.63 → 82.6** | **42.24 → 42.2** | **₹1.09L** | **₹34,95,807 → ₹35.0L** |
| **Stretch model total** | **223.95 → 224** | **158.36 → 158.4** | **115.05 → 115.1** | **64.18 → 64.2** | **₹1.22L** | **₹70,37,422 → ₹70.4L** |

- **Rounding reconciliation:** Previously, Conversations were displayed as integers summing to `120` while the total showed `119`, and Proposals showed 1-decimal rows (`82.6`) while the total showed `83`. Displaying Conversations at 1 decimal reconciles rows and total (`119.2` = `119.2`), and displaying Base total Proposals at 1 decimal (`82.6`) matches the unrounded sum (`82.63`). Remaining `±0.1` differences between summed rounded rows and unrounded model totals (`82.7` vs `82.6`, `42.3` vs `42.2`, `₹34.9L` vs `₹35.0L`) are documented directly below the table, along with the note that Stretch includes `0.5` anchor deal (`₹3.3L`).

### Slide 2 Ordered Waterfall & Cost Reconciliation (Base Case)

| Step | Unrounded Cash / Increment (INR) | Displayed (₹L) |
|---|---:|---:|
| BAU (repeat 2025 playbook) | `₹9,28,490` | `₹9.3L` |
| Cut cold (`PLAN`) | `−₹51,325` | `−₹0.5L` |
| I2 Renewal, Tiering & Upsell | `+₹6,48,762` | `+₹6.5L` |
| I3 Qualified-Lead Recovery + Inbound | `+₹4,04,929` | `+₹4.0L` |
| I4 Alumni & Sponsor Referral Engine | `+₹7,11,590` | `+₹7.1L` |
| I5 Creator & Community Referrals | `+₹2,65,532` | `+₹2.7L` |
| I1 Cash Collection Desk | `+₹5,87,827` | `+₹5.9L` |
| **Sum of 5 initiatives (I1–I5)** | **`₹26,18,642`** | **`₹26.2L`** |
| **Net uplift over BAU (incl. −₹0.5L cold cut)** | **`₹25,67,316`** | **`₹25.7L`** |
| **Final Base Plan (BAU + net uplift)** | **`₹34,95,807`** | **`₹35.0L`** |
| **All-in plan cost** (`₹215K` budget + `₹40K` stipend + `₹52.8K` fees) | **`₹3,07,817`** | **`₹3.08L`** |
| **Net forecast cash after costs** | **`₹31,87,990`** | **`₹31.9L`** |

---

## 3. Structural, Visual & Hyperlink Verification

- **Slide count:** Exactly **3 slides** verified in both `deliverables/RISA_Growth_Strategy.pptx` (`slide1.xml`–`slide3.xml`) and `deliverables/RISA_Growth_Strategy.pdf` (`/Type /Page` count = `3`).
- **Author attribution:** `"Aryan Dongre · IIT Kharagpur"` preserved on Slide 1 and footer attribution preserved across all 3 slides.
- **Visual inspection:** Exported 1920×1080 PNG renders of all 3 slides from PowerPoint (`16.0`) and visually verified layout, alignment, chart labels, table headers, and zero text overlap/overflow.
- **Editable PPTX:** All shapes, tables, text boxes, bar chart, and waterfall blocks remain native editable PowerPoint elements.
- **Hyperlink verification:**
  - PPTX: `ppt/slides/_rels/slide3.xml.rels` contains external hyperlink relationship `Target="https://sponsoros-risa-growth.onrender.com"` and `ppt/slides/slide3.xml` contains `<a:hlinkClick>` on `"Explore SponsorOS — Live Demo ↗"`.
  - PDF: Verified `/URI (https://sponsoros-risa-growth.onrender.com)` link annotation present in `deliverables/RISA_Growth_Strategy.pdf`.
  - Live URL check: `https://sponsoros-risa-growth.onrender.com` returned HTTP `200` serving the deployed `SponsorOS — Sponsorship Revenue-to-Cash OS` web application (`/` and `/api/health` verified).
