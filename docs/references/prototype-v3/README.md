# Prototype v3 reference documents

Read-only source material the specs are derived from. Do not edit; new versions go in a new folder (e.g. `prototype-v4/`).

| File | Description | Status |
|---|---|---|
| `sm-cashier-staffing-report.html` | SM Retail Cashier Staffing report (methodology, Erlang C worked example, research, prototype summary) | Content captured in DOM-001 fixtures; HTML not stored (not needed) |
| `sm-cashier-staffing-calculator.html` | Interactive calculator prototype (reference implementation) | To be added |
| `christmas-2026-hiring-plan-summary.html` | Leadership summary of the Christmas 2026 hiring plan | To be added |

All figures in these documents come from **synthetic data** for 8 sample stores (47,548 hourly rows, Aug 1 – Dec 31 2025).

## Parity anchors captured

The key numbers from the report are recorded as parity fixtures A–C in `docs/03-domain/01-methodology.md` (DOM-001), used by spec task 6.4:

- **A — Erlang C worked example:** λ=240/hr, handle time 2.5 min, A=10 Erlangs → 13 cashiers for 90%-within-60s, avg wait ~14 s (full 11–15 lane table).
- **B — Demo dataset shape:** 47,548 rows, 8 stores, 24 departments, 16 columns, built-in understaffing pattern.
- **C — Scenario outputs:** QC main lanes Dec 19 (3,863 txns, 19 peak); network Dec 19 (254 peak, 555 rostered, 3,688 hours, ≈₱322k); over-capacity flags; part-time savings.

The report HTML is not stored (its parity numbers live in DOM-001). If the calculator HTML is added later, the parity suite can also diff against its live output.
