# Generates the wireframe pages from a shared shell. Re-run after editing: python3 _build.py
import html
ALL="adm exe pln stm hr fin rst stf"
PLANR="exe pln stm hr fin rst"
NAV=[
 (None,[("scr-010-home.html","Home","⌂",ALL),("scr-025-my-roster.html","My roster","M","stf")]),
 ("Plan",[("scr-020-network.html","Network view","N",PLANR),("scr-026-map.html","Network map","◉","exe pln stm hr"),("scr-021-department.html","Department day plan","D",PLANR),
          ("scr-022-roster.html","Weekly roster","R","exe pln stm hr fin"),("scr-023-hiring.html","Hiring plan","H","exe pln stm hr fin"),
          ("scr-024-summary.html","Leadership summary","S","exe pln hr fin")]),
 ("Scenarios",[("scr-030-scenarios.html","All scenarios","☰",PLANR),("scr-032-compare.html","Compare","⇄","exe pln hr fin"),("scr-033-approval.html","Approvals","✓","exe hr fin")]),
 ("Data",[("scr-050-data-sources.html","Data sources","⇪","rst pln adm"),("scr-052-master-data.html","Stores and lanes","▦","exe pln stm hr rst"),("scr-053-staff.html","Staff and availability","☺","pln stm hr rst")]),
 ("Rules",[("scr-060-rule-sets.html","Rule sets","§","exe pln hr fin rst")]),
 ("Admin",[("scr-070-users.html","Users","U","adm"),("scr-072-roles.html","Roles and permissions","P","adm"),("scr-073-audit.html","Audit log","A","adm rst")]),
]
def nav(cur):
    out=['<nav class="sidenav" id="sidenav" aria-label="Main">']
    for head,items in NAV:
        roles=" ".join(sorted(set(" ".join(i[3] for i in items).split())))
        out.append(f'<div data-roles="{roles}">')
        if head: out.append(f'<h2>{head}</h2>')
        out.append('<ul>')
        for f,l,ic,r in items:
            ac=' aria-current="page"' if f==cur else ''
            out.append(f'<li data-roles="{r}"><a href="{f}"{ac}><span class="ico" aria-hidden="true">{ic}</span><span class="lbl">{l}</span></a></li>')
        out.append('</ul></div>')
    out.append('</nav>'); return "\n".join(out)
TOP='''<header class="topbar">
<button class="iconbtn menu-toggle" id="menu-toggle" aria-controls="sidenav" aria-expanded="false" aria-label="Open navigation">≡</button>
<a class="brand" href="scr-010-home.html">SM Cashier Planner</a>
<form class="search" id="searchform" role="search" action="scr-041-search.html"><label class="sr-only" for="q">Search</label>
<input id="q" name="q" type="search" placeholder="Search stores, departments, scenarios, staff…  ( / )"></form>
<button class="iconbtn search-toggle" id="search-toggle" aria-controls="searchform" aria-label="Search">⌕</button>
<div class="row" style="margin-left:auto;gap:8px">
<label for="lang" class="sr-only">Language</label><select id="lang" title="Language"><option value="en">EN</option><option value="fil">FIL</option></select>
<label for="role" style="color:#ddd">Viewing as</label>
<select id="role" title="Demo mode: switch role">
<option value="adm">System Admin</option><option value="exe">Executive</option><option value="pln">Planner</option>
<option value="stm">Store Manager</option><option value="hr">HR</option><option value="fin">Finance</option><option value="rst">Rules Steward</option><option value="stf">Staff</option></select>
<div class="menu"><button class="iconbtn" aria-haspopup="true" aria-expanded="false" aria-controls="bellpop">🔔 <span class="badge" aria-label="3 unread">3</span><span class="sr-only">Notifications</span></button>
<div class="pop" id="bellpop" hidden><ul>
<li data-roles="adm exe pln stm hr fin rst">⚠ <b>Offers due in 5 days</b><br><span class="muted">Christmas 2026 v3 · <a href="scr-023-hiring.html">Hiring plan</a></span></li>
<li data-roles="exe">✓ <b>Plan ready for your approval</b><br><span class="muted">Headcount and budget secured · <a href="scr-033-approval.html">Review</a></span></li>
<li data-roles="hr">✓ <b>Headcount approval requested</b><br><span class="muted">Christmas 2026 v4 · <a href="scr-033-approval.html">Review</a></span></li>
<li data-roles="fin">✓ <b>Budget approval requested</b><br><span class="muted">Christmas 2026 v4 · <a href="scr-033-approval.html">Review</a></span></li>
<li data-roles="stf">✎ <b>Your Sat Dec 19 shift changed</b><br><span class="muted">Now 12p–9p · <a href="scr-025-my-roster.html">My roster</a></span></li>
<li data-roles="stm pln">⚠ <b>2 unfilled shifts Sat Dec 19</b><br><span class="muted">QC main lanes · <a href="scr-022-roster.html">Roster</a></span></li>
<li data-roles="pln rst">ⓘ <b>POS data refreshed</b> — 2 scenarios stale<br><span class="muted"><a href="scr-030-scenarios.html">Scenarios</a></span></li>
</ul><p><a href="scr-040-notifications.html">See all notifications</a></p></div></div>
<div class="menu"><button class="iconbtn" aria-haspopup="true" aria-expanded="false" aria-controls="userpop">JD ▾<span class="sr-only"> User menu</span></button>
<div class="pop" id="userpop" hidden style="width:220px"><ul>
<li><b>Juan dela Cruz</b><br><span class="muted">juan@smretail.com</span></li>
<li><a href="scr-080-profile.html">Profile, passkeys and preferences</a></li>
<li><a href="scr-091-help.html">Help and keyboard shortcuts</a></li>
<li><a href="scr-001-sign-in.html#signed-out">Sign out</a></li></ul></div></div>
</div></header>'''
def page(fname,title,crumbs,body,page_roles=ALL,sample=True,mobile_ro=True):
    cr="".join(f'<li>{c}</li>' if not isinstance(c,tuple) else f'<li><a href="{c[1]}">{c[0]}</a></li>' for c in crumbs)
    doc=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} — Wireframe</title><link rel="stylesheet" href="wireframe.css"><script src="wireframe.js" defer></script></head>
<body data-page-roles="{page_roles}"{" data-mobile-ro" if mobile_ro else ""}><a class="skip" href="#main">Skip to content</a>
{TOP}
<div class="layout">{nav(fname)}
<main id="main" tabindex="-1">
<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="index.html">Screen map</a></li>{cr}</ol></nav>
{'<p class="sample" role="note">⚠ Sample data — figures are simulated, not SM actuals.</p>' if sample else ''}
<div class="noaccess" id="noaccess" hidden><h1>No access</h1><p>Your role doesn't include this screen. <a href="scr-010-home.html">Go to Home</a></p></div>
<div id="content">
{'<p class="ro-note" role="note">Read-only on a phone. Open on a tablet or computer to edit.</p>' if mobile_ro else ''}
{body}
</div></main></div></body></html>'''
    open(fname,"w").write(doc)

def ctx(fields, extra=""):
    opts={"scenario":'<div><label for="c-sc">Scenario</label><select id="c-sc"><option>★ Christmas 2026 v3 · Published</option><option>Christmas 2026 v4 · Draft · Stale</option></select></div>',
    "region":'<div><label for="c-rg">Region</label><select id="c-rg"><option>All in scope</option><option>Luzon</option><option>Visayas</option><option>Mindanao</option></select></div>',
    "format":'<div><label for="c-fm">Format</label><select id="c-fm"><option>All formats</option><option>SM Supermarket</option><option>SM Hypermarket</option><option>The SM Store</option><option>SaveMore</option></select></div>',
    "store":'<div><label for="c-st">Store</label><select id="c-st"><option>SM Supermarket – Quezon City</option><option>SM Supermarket – Cebu City</option></select></div>',
    "dept":'<div><label for="c-dp">Department</label><select id="c-dp"><option>Main checkout lanes</option><option>Express lanes</option></select></div>',
    "date":'<div><label for="c-dt">Date</label><input id="c-dt" type="date" value="2026-12-19"></div>',
    "season":'<div><label for="c-ss">Season</label><select id="c-ss"><option>Nov 2 – Dec 31 (9 wk)</option><option>Nov 16 – Dec 31</option><option>Nov 30 – Dec 31</option></select></div>',
    "weeks":'<div><label for="c-wk">Weeks</label><select id="c-wk"><option>1</option><option selected>4</option><option>8</option><option>14</option></select></div>'}
    return f'''<div class="ctx" role="group" aria-label="Plan context and filters">{"".join(opts[f] for f in fields)}
<div class="row" style="margin-left:auto"><button class="btn" data-open="savedviews">Saved views ▾</button><button class="btn" data-open="settings" data-roles="pln">⚙ Adjust settings</button><button class="btn" data-open="settings" data-roles="exe stm hr fin rst">View settings</button>{extra}</div></div>
<dialog id="savedviews" aria-labelledby="sv-h"><h2 id="sv-h">Saved views</h2><ul><li><a href="#">Luzon hypermarkets, Dec 24</a> (default)</li><li><a href="#">Over capacity — all stores</a></li></ul>
<label for="svn">Save current filters as</label><input id="svn" type="text"> <label><input type="checkbox"> Make default for this screen</label>
<p class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" data-close>Save view</button></p><p class="muted">Filters are also in the URL, so the address can be shared.</p></dialog>
<dialog id="settings" class="drawer" aria-labelledby="set-h"><h2 id="set-h">Scenario settings</h2>
<p class="alert info" data-roles="pln">This scenario is <b>Published</b> and read-only. <button class="btn small">Duplicate as draft</button></p>
<p class="alert info" data-roles="exe stm hr fin rst">Read-only for your role.</p>
<fieldset><legend>Service and labor</legend><div class="formgrid"><div><label for="s1">Served within target (%)</label><input id="s1" type="number" value="90"></div><div><label for="s2">…this wait (s)</label><input id="s2" type="number" value="60"></div><div><label for="s3">Shrinkage</label><input id="s3" type="number" value="1.30" step="0.01"></div><div><label for="s4">Minimum open lanes</label><input id="s4" type="number" value="1"></div></div></fieldset>
<fieldset><legend>Shift rules</legend><div class="formgrid"><div><label for="s5">Full-time shift</label><select id="s5"><option>8 h + 1 h meal</option></select></div><div><label><input type="checkbox" checked> Part-time peak shifts</label></div><div><label for="s6">Absence reserve</label><input id="s6" type="number" value="8"></div></div></fieldset>
<p><a href="scr-031-scenario-settings.html">Open all settings</a></p>
<p class="row"><button class="btn" data-close>Close</button><button class="btn primary" data-close data-roles="pln">Save and recalculate</button></p></dialog>'''

def kpis(items):
    return '<div class="kpis">'+"".join(f'<div class="kpi{" focus" if i==0 else ""}"><div class="l">{l}</div><div class="v">{v}</div><div class="d">{d}</div></div>' for i,(l,v,d) in enumerate(items))+'</div>'
def ph(label,h=200): return f'<div class="ph" style="min-height:{h}px" role="img" aria-label="{html.escape(label)} (placeholder)">[ {html.escape(label)} ]<br><button class="btn small" type="button">View as table</button></div>'
def table(cap,head,rows,sortable=True):
    th="".join(f'<th scope="col"{" class=num" if h.startswith("#") else ""}>{"<button class=sort>"+h.lstrip("#")+"</button>" if sortable else h.lstrip("#")}</th>' for h in head)
    body=""
    for r in rows:
        cls=' class="group"' if r[0].startswith("!") else ''
        cells=[r[0].lstrip("!")]+list(r[1:])
        body+=f'<tr{cls}><th scope="row">{cells[0]}</th>'+"".join(f'<td>{c}</td>' for c in cells[1:])+'</tr>'
    return f'<div class="tablewrap"><table><caption>{cap}</caption><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>'

# ---------- visual planning components ----------
def fmt(h):
    h=h%24; return f"{12 if h%12==0 else h%12}{'a' if h<12 else 'p'}"
def fmtt(x):
    h=int(x); m=int(round((x-h)*60)); ap='AM' if h%24<12 else 'PM'; hh=12 if h%12==0 else h%12
    return f"{hh}:{m:02d} {ap}"
ACTL={"meal":"M","train":"T","huddle":"H"}
def timeline(rows,deltas,caption,start=7,end=23,editable=True,cov=None):
    span=end-start
    def pc(h): return (h-start)/span*100
    head=''.join(f'<span class="hr" style="left:{pc(h)}%">{fmt(h)}</span>' for h in range(start,end))
    dch=''
    for i,d in enumerate(deltas):
        cls="neg" if d<0 else "pos" if d>0 else "zero"
        dch+=f'<span class="dchip {cls}" style="left:{pc(start+i)}%;width:{100/span}%" title="{fmt(start+i)}: {d:+d} vs required"><span>{d:+d}</span></span>'
    sel='<label><input type="checkbox" id="selectall"> <span class="sr-only">Select all shifts</span></label>' if editable else ''
    out=[f'<div class="tl-wrap" role="region" aria-label="{caption}" tabindex="0"><div class="tl" style="--cols:{span}">',
         f'<div class="tl-row head"><div class="tl-meta">{sel}<b>Cashier</b><span class="muted" style="margin-left:auto">Skills</span></div><div class="tl-track">{head}</div></div>',
         f'<div class="tl-row delta"><div class="tl-meta"><b>Staffing vs need</b><span class="muted">per hour</span></div><div class="tl-track">{dch}</div></div>']
    for r in rows:
        sk=''.join(f'<span class="skill">{k}</span>' for k in r.get("skills",[]))
        if editable and "shift" in r: chk=f'<input type="checkbox" data-select aria-label="Select {r["id"]} shift">'
        elif editable: chk='<span style="width:13px"></span>'
        else: chk=''
        meta=f'<div class="tl-meta">{chk}<span class="av" aria-hidden="true">{r["id"][:2]}</span><span><b>{r["id"]}</b> {r.get("name","")}<br><span class="muted">{r["type"]}</span></span><span style="margin-left:auto">{sk}</span></div>'
        tr=''
        if "off" in r:
            tr=f'<span class="offband{" unav" if r["off"]=="Unavailable" else ""}">{r["off"]}</span>'
        if "shift" in r:
            a,b=r["shift"]; acts=r.get("acts",[]); d=r.get("dept","main")
            lab=f'{r["id"]}: {fmtt(a)} – {fmtt(b)}'+''.join(f', {k} {fmtt(x)}' for x,y,k in acts)
            cls=f'bar-shift d-{d}'+(' float' if r.get("float") else '')+(' edited' if r.get("edited") else '')
            ed=' ✎' if r.get("edited") else ''
            tr+=f'<button class="{cls}" data-dept="{d}" style="left:{pc(a)}%;width:{(b-a)/span*100}%" data-open="shiftpop" aria-label="{lab}. Edit shift">{fmtt(a)}–{fmtt(b)}{ed}</button>'
            for x,y,k in acts:
                tr+=f'<span class="act {k}" style="left:{pc(x)}%;width:{(y-x)/span*100}%" aria-hidden="true">{ACTL[k]}</span>'
        out.append(f'<div class="tl-row">{meta}<div class="tl-track">{tr}</div></div>')
    if cov:
        cv=''.join(f'<span class="cov" style="left:{pc(start+i)}%;height:{min(32,v*1.6)}px" title="{fmt(start+i)} required {v}"></span>' for i,v in enumerate(cov))
        out.append(f'<div class="tl-row" style="min-height:40px"><div class="tl-meta"><b>Required on lanes</b><span class="muted">Erlang C</span></div><div class="tl-track">{cv}</div></div>')
    out.append('</div></div>')
    return ''.join(out)
LEG='<div class="legend" aria-label="Legend"><span><i class="d-main"></i>Main lanes</span><span><i class="d-exp"></i>Express</span><span><i class="d-cs"></i>Customer service</span><span><i style="background:repeating-linear-gradient(45deg,#fff 0 3px,#999 3px 6px)"></i>Float</span><span><i style="background:#fff;border-style:dashed"></i>M Meal</span><span><i style="background:var(--a-train)"></i>T Training</span><span><i style="background:var(--a-huddle)"></i>H Huddle</span><span><i style="outline:2px dashed #111"></i>✎ Manager change</span><span><b style="color:var(--neg)">−2</b> short · <b>+1</b> surplus</span></div>'
SHIFTPOP="""<dialog id="shiftpop" aria-labelledby="spp-h"><div class="row spread"><h2 id="spp-h">PT-02 Maria Santos</h2><button class="btn small" data-close aria-label="Close">×</button></div>
<p class="muted">Sat, Dec 19, 2026 · 8 h paid · Main checkout lanes</p>
<div class="seg" role="tablist" aria-label="Shift editor mode"><button role="tab" aria-selected="true" aria-controls="sp1">Edit shift</button><button role="tab" aria-selected="false" tabindex="-1" aria-controls="sp2">Emergency off / reassign</button></div>
<div id="sp1" role="tabpanel"><div class="formgrid" style="margin-top:10px"><div><label for="sd1">Start</label><input id="sd1" type="date" value="2026-12-19"> <select aria-label="Start time"><option>12:00 PM</option></select></div><div><label for="ed1">End</label><input id="ed1" type="date" value="2026-12-19"> <select aria-label="End time"><option>9:00 PM</option></select></div></div>
<table><caption>Activities</caption><tbody><tr><th scope="row">Meal break (60 min)</th><td>4:00 PM – 5:00 PM</td><td><button class="btn small" aria-label="Remove meal break">×</button></td></tr><tr><th scope="row">Training (30 min)</th><td>1:30 PM – 2:00 PM</td><td><button class="btn small" aria-label="Remove training">×</button></td></tr></tbody></table>
<p class="row"><button class="btn small">+ Add activity</button></p>
<p class="muted">Rule check: ✓ rest ≥ 10 h · ✓ 5 days this week · ⚠ 32 h (PT limit 30 h — reason required)</p></div>
<div id="sp2" role="tabpanel" hidden><fieldset><legend>Replacement (eligible first)</legend><label><input type="radio" name="rp" checked> FT-07 · same store · 5 days, 40 h ✓</label><label><input type="radio" name="rp"> PT-05 · same store · would exceed 30 h ⚠</label><label><input type="radio" name="rp"> Find cover from nearby stores → <a href="scr-026-map.html">Network map</a></label></fieldset>
<label for="rs2">Reason</label><select id="rs2"><option>Sick call</option><option>Family emergency</option></select></div>
<p class="row spread"><span class="muted">Drag a bar to move it; drag its edges to resize.</span><span class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" data-close>Save</button></span></p></dialog>"""
BULK='<div class="bulkbar" id="bulkbar" hidden role="toolbar" aria-label="Bulk actions"><span id="bulkcount">1 shift selected</span><button id="bulkclear" aria-label="Clear selection">×</button><button>✎ Edit</button><button>Reassign</button><button>Time off</button><button>Copy to…</button></div>'

P=[]
# ---------- SCR-010 Home ----------
page("scr-010-home.html","Home",["Home"],f'''
<h1>Good morning, Juan</h1>
<section data-roles="pln" aria-labelledby="h-pln"><h2 id="h-pln" class="sr-only">Planner home</h2>
<div class="grid2"><div class="card"><h2>Needs attention</h2><ul>
<li>⚠ 2 scenarios are stale after the POS refresh — <a href="scr-030-scenarios.html">Review</a></li>
<li>⚠ 3 departments over lane capacity on Dec 24 — <a href="scr-020-network.html">Network view</a></li>
<li>ⓘ Draft “Christmas 2026 v4” run complete — <a href="scr-023-hiring.html">Open</a></li></ul></div>
<div class="card"><h2>Deadlines</h2><ol class="timeline"><li><b>Oct 5</b><span class="pill warn">In 5 days</span><span>Send offers</span></li><li><b>Oct 12</b><span class="pill">Upcoming</span><span>Training starts</span></li><li><b>Nov 2</b><span class="pill">Wave 1</span><span>56 on the lanes</span></li></ol></div></div></section>
<section data-roles="exe"><div class="grid2"><div class="card"><h2>Waiting for your approval</h2><p>Christmas 2026 v4 — headcount ✓ HR · budget ✓ recorded outside the system. <a class="btn primary" href="scr-033-approval.html">Review plan</a></p></div>
<div class="card"><h2>Published plan</h2><p>★ Christmas 2026 v3 · <a href="scr-024-summary.html">Leadership summary</a></p></div></div></section>
<section data-roles="stm"><div class="card"><h2>This week — SM Supermarket Quezon City</h2><p>⚠ 2 unfilled shifts on Sat Dec 19 (main lanes) · ✕ 1 labor-rule check failing</p><a class="btn primary" href="scr-022-roster.html">Open weekly roster</a> <a class="btn" href="scr-053-staff.html">Update availability</a></div></section>
<section data-roles="hr"><div class="card"><h2>Headcount approval</h2><p>Christmas 2026 v4 asks for 251 seasonal cashiers. <a class="btn primary" href="scr-033-approval.html">Review headcount</a></p></div><div class="card"><h2>Recruiting timeline</h2><p>Offers due in 5 days · 313–327 to recruit · <a href="scr-023-hiring.html">Hiring plan</a></p></div></section>
<section data-roles="fin"><div class="card"><h2>Budget approval</h2><p>Christmas 2026 v4 season cost ₱13.1M. <a class="btn primary" href="scr-033-approval.html">Review budget</a></p></div><div class="card"><h2>Cost watch</h2><p>Season cashier cost ₱13.6M (published) · Draft v4 ₱13.1M · <a href="scr-032-compare.html">Compare</a></p></div></section>
<section data-roles="rst"><div class="grid2"><div class="card"><h2>Data freshness</h2><p>POS hourly: Sep 28 ✓ · Staff roster: not loaded — <a href="scr-050-data-sources.html">Data sources</a></p></div><div class="card"><h2>Draft rule versions</h2><p>Wage rates 2026.2 (draft) — <a href="scr-061-rule-editor.html">Continue editing</a></p></div></div></section>
<section data-roles="stf"><div class="card"><h2>Your next shifts — SM Supermarket QC · Main lanes</h2><ul><li><b>Tue Dec 15</b> 3p–7p</li><li><b>Sat Dec 19</b> 12p–9p · meal 4p <span class="pill warn">Changed</span></li></ul><a class="btn primary" href="scr-025-my-roster.html">My roster</a></div></section>
<section data-roles="adm"><div class="grid2"><div class="card"><h2>Pending invitations</h2><p>3 users invited, not yet signed in — <a href="scr-070-users.html">Users</a></p></div><div class="card"><h2>Recent audit events</h2><p><a href="scr-073-audit.html">Audit log</a></p></div></div></section>
<div data-roles="exe pln hr fin">{kpis([("Seasonal hires","284","176 FT · 108 PT"),("To recruit","313–327","+10–15% buffer"),("First needed","Nov 2","offers due Oct 5"),("Season cost","₱13.6M","published plan")])}</div>
<div data-roles="pln exe">{table("Recent scenarios",["Scenario","Status","Updated","Owner"],[["<a href=scr-023-hiring.html>★ Christmas 2026 v3</a>",'<span class="pill solid">Published</span>',"Oct 1","Ana"],["<a href=scr-023-hiring.html>Christmas 2026 v4</a>",'<span class="pill">Submitted</span> <span class="pill warn">Stale</span>',"Oct 3","Ana"]])}</div>
<p class="wfnote">Home content changes by role. Use “Viewing as” in the top bar (demo mode) to switch.</p>''',mobile_ro=False)
# ---------- SCR-020 Network ----------
page("scr-020-network.html","Network view",[("Plan","scr-020-network.html"),"Network view"],f'''
<div class="row spread"><h1>All stores and departments</h1><div class="row"><nav class="seg" aria-label="View"><a class="btn small" aria-current="page" href="scr-020-network.html">Charts and table</a> <a class="btn small" href="scr-026-map.html">◉ Map</a></nav><button class="btn" aria-haspopup="true">Export ▾</button></div></div>
{ctx(["scenario","region","format","date"])}
<p class="row"><span class="pill">Sat</span><span class="pill">Dec 18–23</span><span class="pill">Payday</span><span class="pill">8 stores · 24 departments</span></p>
{kpis([("Network peak on lanes","254","at 5 PM"),("Cashiers rostered","555","314 FT · 188 PT · 53 float"),("Paid hours","3,688","×2.1 vs weekday"),("Roster cost","₱322k","day-type pay · NSD"),("Over lane capacity","2 of 24","departments"),("Last year, same day","41% short","dept-hours")])}
<div class="alert" role="alert">⚠ Over installed lanes: <b>Cebu City · Main lanes</b> (needs 26, has 24, 3 h); <b>SaveMore Iloilo · Checkout</b> (needs 13, has 12). <a href="scr-021-department.html">Investigate</a></div>
<div class="card"><h2>Cashiers needed on lanes by hour, stacked by store</h2>{ph("Stacked column chart: hour × store",220)}</div>
<div class="card"><h2>Lane-capacity pressure by department and hour</h2>{ph("Heatmap: department rows × hour columns, value in each cell, click a cell → department day plan",260)}<p class="muted">Cells show the number of cashiers needed; shading shows the share of installed lanes. Values are always printed, not color only.</p></div>
<div class="row"><label for="sort">Sort</label><select id="sort"><option>Grouped by store</option><option>Lane-capacity pressure</option><option>Cashiers rostered</option><option>Roster cost</option><option>Last year's understaffing</option></select><label for="tf" class="sr-only">Filter rows</label><input id="tf" type="search" placeholder="Filter rows"></div>
{table("Staffing plan by store and department",["Store / department","#Forecast tx","#vs weekday","#Peak on lanes","#Installed lanes","#Cashiers","#Paid h","#Cost ₱","#LY hours short"],[
["!SM Supermarket – Quezon City","6,120","×2.25","29 @1pm","48","48","382","31,900","14/41"],
['<a href="scr-021-department.html">Main checkout lanes ›</a>',"3,863","×2.25","19 @1pm",'30 <span class="bar" style="width:40px"></span>',"25","296","24,700","6/13"],
['<a href="scr-021-department.html">Express lanes ›</a>',"1,902","×2.10","7 @6pm","11","9","66","5,500","5/13"],
["!SM Supermarket – Cebu City","4,410","×2.30","31 @5pm","39","44","310","26,100","12/41"],
['<a href="scr-021-department.html">Main checkout lanes ›</a> <span class="pill warn">Over cap +2</span>',"2,980","×2.35","26 @5pm","24","30","240","20,000","8/13"]])}
<p class="wfnote">Store managers see only their store's rows and KPIs. Executives and Finance see everything read-only.</p>''',page_roles=PLANR)
# ---------- SCR-021 Department ----------
page("scr-021-department.html","Department day plan",[("Plan","scr-020-network.html"),("SM Supermarket – QC","scr-020-network.html"),"Main checkout lanes"],f'''
<div class="row spread"><h1>Main checkout lanes — Sat Dec 19, 2026</h1><div class="row"><a class="btn" href="scr-022-roster.html">Open weekly roster ›</a><button class="btn">Export ▾</button></div></div>
{ctx(["scenario","store","dept","date"])}
<p class="row"><span class="pill">Sat</span><span class="pill">Dec 18–23</span><span class="pill">Open 9 AM – 10 PM</span><span class="pill">vs LY: Sat Dec 20, 2025</span></p>
{kpis([("Peak cashiers on lanes","19","at 1 PM · weekday 12"),("Scheduled at peak","25","incl. shrinkage"),("Cashier-hours","296","vs 180 on a weekday"),("Labor cost","₱24.7k","day type ×1.00"),("Forecast transactions","3,863","×2.25 vs weekday"),("Last year, same day","6/13 h short","worst 1 PM: 15 vs 19")])}
<div class="card"><h2>Hourly demand vs required cashiers</h2>{ph("Combo chart: transactions (columns), on lanes, scheduled, LY open, installed lanes (lines)",240)}</div>
{table("Hour-by-hour staffing plan",["Hour","#Tx","#Erlangs","#On lanes","#Scheduled","#Utilization","#% within 60 s","#Avg wait","#LY tx","#LY open","#LY needed","#Cost ₱"],[
["9 AM","151","6.3","8","11","79%","91%","12 s","147","8","8","957"],["1 PM","339","14.1","19","25","74%","92%","10 s","322","15","19","2,175"],["10 PM <span class=pill>NSD</span>","90","3.8","5","7","76%","90%","13 s","88","6","6","670"]])}
<div class="card"><h2>Last year's staffing vs need (Oct–Dec 2025)</h2>{kpis([("Hours understaffed","38%","412 of 1,092"),("Lane-hours missing","640","short × hours"),("Lane-hours surplus","210","beyond need")])}{ph("Weekly column chart: % of hours understaffed",160)}</div>
<div class="card"><h2>Shift builder — suggested shifts</h2>{kpis([("Cashiers rostered","28","16 FT · 10 PT · 2 float"),("Paid hours","296","vs 325 flat shrinkage"),("Coverage efficiency","88%","31 surplus lane-h")])}
{LEG}
{timeline([dict(id="C1",type="Full-time",shift=(9,18),acts=[(13,14,"meal")]),dict(id="C2",type="Full-time",shift=(10,19),acts=[(14,15,"meal"),(10,10.5,"huddle")]),dict(id="C17",type="Part-time peak",shift=(11,15)),dict(id="C18",type="Part-time peak",shift=(17,21)),dict(id="C27",type="Float (absence cover)",shift=(11,20),float=True,acts=[(15,16,"meal")])],[0,0,1,0,0,0,1,0,0,-1,0,0,0,0,0,0],"Suggested shifts for the day",editable=False,cov=[8,9,10,14,17,19,17,15,14,16,18,19,17,12,7,5])}
<p class="muted">Unnamed shifts (C1…) from the shift builder. Named cashiers are assigned in the roster.</p><button class="btn">Export CSV</button></div>
<details class="card"><summary><b>How it works</b></summary><p>Erlang C per hour, shrinkage, shift builder rules. The text comes from the methodology (DOM-001).</p></details>''',page_roles=PLANR)
# ---------- SCR-022 Roster ----------
TL_ROWS=[dict(id="FT-01",name="Isa Palma",type="Full-time · rest Mon",skills=["Main","Express"],shift=(9,18),acts=[(13,14,"meal"),(9,9.5,"huddle")]),
 dict(id="FT-03",name="Cora Fisco",type="Full-time",skills=["Main","CS"],shift=(10,19),acts=[(14,15,"meal"),(11,11.5,"train")]),
 dict(id="FT-07",name="Ralph Edu",type="Full-time",skills=["Main"],off="Day off"),
 dict(id="PT-02",name="Maria Santos",type="Part-time · students",skills=["Main"],shift=(12,21),acts=[(16,17,"meal"),(13.5,14,"train")],edited=True),
 dict(id="PT-05",name="Guy Hapin",type="Part-time",skills=["Express"],dept="exp",shift=(15,19)),
 dict(id="FT-09",name="Dina Rusel",type="Full-time",skills=["CS","Main"],dept="cs",shift=(8,17),acts=[(12,13,"meal")]),
 dict(id="PT-06",name="Arlene Mac",type="Part-time · no Sundays",skills=["Main"],off="Unavailable"),
 dict(id="XS-14",name="Jo Tan",type="Borrowed · SM Megamall (22 min)",skills=["Main"],shift=(13,17),edited=True),
 dict(id="FL-01",name="Cam Wills",type="Float",skills=["Main","Express","CS"],shift=(11,20),float=True,acts=[(15,16,"meal")])]
def wkchip(d,l,a,b,edited=False):
    ed=' ✎' if edited else ''; al=', manager change' if edited else ''
    return f'<button class="chip" data-dept="{d}" data-open="shiftpop" aria-label="{l} {a} to {b}{al}"><b class="d-{d}">{l}</b><span>{a}<br>{b}{ed}</span></button>'
E='<div class="chip empty" aria-label="No shift"></div>'
WK=[("FT-01 Isa Palma",["R",("main","M","09:00","18:00"),("main","M","09:00","18:00"),("main","M","09:00","18:00"),("main","M","09:00","18:00"),("main","M","12:00","21:00"),("main","M","10:00","19:00")]),
    ("PT-02 Maria Santos",["U",("main","M","15:00","19:00"),"",("main","M","15:00","19:00"),"",("main","M","12:00","21:00",True),""]),
    ("PT-05 Guy Hapin",["",("exp","E","15:00","19:00"),("exp","E","15:00","19:00"),"",("exp","E","17:00","21:00"),("exp","E","15:00","19:00"),("exp","E","13:00","17:00")]),
    ("FT-09 Dina Rusel",[("cs","C","08:00","17:00"),("cs","C","08:00","17:00"),"R",("cs","C","08:00","17:00"),("cs","C","08:00","17:00"),("cs","C","09:00","18:00"),("cs","C","09:00","18:00")])]
def wkcell(c):
    if c=="R": return '<div class="chip empty"><span>Rest day</span></div>'
    if c=="U": return '<div class="chip empty" style="background:repeating-linear-gradient(45deg,#f6f6f6 0 6px,#e9e9e9 6px 12px)"><span>Unavailable</span></div>'
    if not c: return E
    return wkchip(*c)
days=["Mon 14","Tue 15","Wed 16","Thu 17","Fri 18","Sat 19","Sun 20"]
WKT='<table class="wk"><caption class="sr-only">Week of Dec 14 to 20</caption><thead><tr><th scope="col"><span class="sr-only">Cashier</span></th>'+''.join(f'<th scope="col">{d}</th>' for d in days)+'</tr></thead><tbody>'
WKT+=''.join(f'<tr><th scope="row" style="font-size:12px;text-align:left">{n}</th>'+''.join(f'<td>{wkcell(c)}</td>' for c in cells)+'</tr>' for n,cells in WK)
WKT+='<tr><th scope="row" style="font-size:12px;text-align:left">Open shifts</th>'+''.join(f'<td>{E}</td>' for _ in range(5))+'<td><button class="chip" data-open="shiftpop" style="border:2px dashed var(--neg)"><b style="background:var(--neg);color:#fff">!</b><span>13:00<br>17:00 ×2</span></button></td><td>'+E+'</td></tr></tbody></table>'
MONTH='<div class="month" aria-label="December 2026">'+''.join(f'<div><b>{d}</b><br>{"112" if d%7 else "98"} shifts<br>'+('<span style="color:var(--neg)">−2 open</span>' if d in (19,24) else '✓ filled')+'</div>' for d in range(1,32))+'</div>'
page("scr-022-roster.html","Roster",[("Plan","scr-020-network.html"),("SM Supermarket – QC","scr-020-network.html"),"Roster"],f'''
<div class="row spread"><h1>Roster — Main checkout lanes</h1><div class="row"><button class="btn" data-roles="pln stm">Auto-build</button><button class="btn">Export ▾</button></div></div>
{ctx(["scenario","store","dept"])}
<div class="row spread" style="margin-bottom:10px"><div class="datenav" aria-label="Date"><button aria-label="Previous">‹</button><b>Sat, Dec 19, 2026</b><button aria-label="Next">›</button></div>
<div class="seg" role="tablist" aria-label="Zoom"><button role="tab" aria-selected="true" aria-controls="v-day">Day</button><button role="tab" aria-selected="false" tabindex="-1" aria-controls="v-week">Week</button><button role="tab" aria-selected="false" tabindex="-1" aria-controls="v-week">Fortnight</button><button role="tab" aria-selected="false" tabindex="-1" aria-controls="v-week">Four weeks</button><button role="tab" aria-selected="false" tabindex="-1" aria-controls="v-month">Month</button></div></div>
<div class="alert" role="alert">⚠ <b>2 open shifts</b> Sat Dec 19, 1–5 PM. <a class="btn small" href="scr-026-map.html">Find cover nearby</a> <button class="btn small" data-roles="pln stm">Offer to eligible staff</button></div>
<details class="card" data-roles="stm pln" open><summary><b>Staff requests</b> — 2 pending</summary><table><caption class="sr-only">Pending staff requests</caption><thead><tr><th>Staff</th><th>Type</th><th>Detail</th><th>Actions</th></tr></thead><tbody><tr><td>PT-02 Maria Santos</td><td>Time off</td><td>Dec 24 (family)</td><td class="row"><button class="btn small">Decline</button><button class="btn small primary">Approve</button></td></tr><tr><td>PT-05 Guy Hapin</td><td>Swap</td><td>Sat Dec 19 12p–9p ⇄ Tue open 3p–7p</td><td class="row"><button class="btn small">Decline</button><button class="btn small primary">Approve</button></td></tr></tbody></table><p class="muted">Approving a swap applies it as a roster change; a time-off approval frees the cashier and flags any newly open shifts. A change that breaks a rule needs a reason.</p></details>
<section id="v-day" role="tabpanel" aria-label="Day view">
{LEG}
{timeline(TL_ROWS,[0,-1,0,1,0,0,-2,-2,-1,0,1,0,0,0,0,0],"Day timeline: cashiers by hour",cov=[4,5,7,9,11,12,12,11,10,11,12,12,11,8,5,3])}
{BULK}
</section>
<section id="v-week" role="tabpanel" hidden aria-label="Week view"><div class="wk-layout">
<aside class="card"><ul class="statlist"><li><span class="v">112</span>Total shifts</li><li><span class="v">₱98,600</span>Total cost</li><li><span class="v">1,184</span>Paid hours</li><li><span class="v" style="color:var(--neg)">2</span>Open shifts</li><li><span class="v">1</span>Borrowed from other stores</li></ul><p><button class="btn small">Quick build</button> <button class="btn small">Copy last week</button></p></aside>
<div class="tablewrap" style="border:0">{WKT}</div>
<aside class="card"><fieldset><legend>Departments</legend><label><input type="checkbox" checked data-filter-dept="main"> Main lanes</label><label><input type="checkbox" checked data-filter-dept="exp"> Express</label><label><input type="checkbox" checked data-filter-dept="cs"> Customer service</label></fieldset>
<fieldset><legend>Colour by</legend><label><input type="radio" name="cb" checked> Department</label><label><input type="radio" name="cb"> Contract (FT/PT/float)</label><label><input type="radio" name="cb"> Home store (shows borrowed staff)</label></fieldset></aside></div>
<p class="muted">Fortnight and Four weeks use the same grid with narrower chips (start time only).</p></section>
<section id="v-month" role="tabpanel" hidden aria-label="Month view">{MONTH}</section>
<details class="card"><summary><b>Labor-rule checks</b> — 1 issue</summary><ul><li>✓ Working days within limits</li><li>✓ Weekly hours</li><li>✓ Consecutive days ≤ 6 (across weeks and stores)</li><li>✓ Rest ≥ 10 h</li><li>✕ 2 open shifts</li><li>⚠ PT-02 32 h (override: sick-call cover)</li></ul></details>
{SHIFTPOP}
<p class="wfnote">Day = timeline (drag to move or resize, click to edit, tick rows for bulk actions). Week = shift chips with department colours and filters. Month = coverage per day. Borrowed cashiers (XS-14) come from the network map. On a phone, Day becomes a list per cashier, and only Emergency off / reassign is editable.</p>''',page_roles="exe pln stm hr fin",mobile_ro=False)

# ---------- SCR-026 Network map ----------
import random
random.seed(11)
def xy(lat,lon): return round((lon-120.94)/0.18*560+20,1), round((14.78-lat)/0.41*720+20,1)
# SM malls in Metro Manila (source: Wikipedia "List of shopping malls in Metro Manila"). Coordinates are approximate; geocode before use.
STORES=[("moa","SM Mall of Asia","Pasay",14.535,120.982,-2),("mega","SM Megamall","Mandaluyong",14.585,121.056,-4),("nedsa","SM North EDSA","Quezon City",14.656,121.029,-3),
("cong","SM Center Congressional","Quezon City",14.672,121.041,0),("lp","SM Center Las Piñas","Las Piñas",14.450,120.981,1),("mun","SM Center Muntinlupa","Muntinlupa",14.389,121.047,0),
("pasig","SM Center Pasig","Pasig",14.573,121.066,2),("sang","SM Center Sangandaan","Caloocan",14.658,120.972,-1),("shaw","SM Center Shaw","Mandaluyong",14.584,121.043,1),
("bf","SM City BF Parañaque","Parañaque",14.450,121.023,0),("bic","SM City Bicutan","Parañaque",14.487,121.043,-1),("cal","SM City Caloocan","Caloocan",14.752,121.022,0),
("eort","SM City East Ortigas","Pasig",14.590,121.103,1),("fair","SM City Fairview","Quezon City",14.734,121.057,-2),("gc","SM City Grand Central","Caloocan",14.655,120.984,0),
("mnl","SM City Manila","Manila",14.590,120.983,2),("mar","SM City Marikina","Marikina",14.625,121.083,1),("nova","SM City Novaliches","Quezon City",14.711,121.036,0),
("sanl","SM City San Lazaro","Manila",14.617,120.985,-1),("stam","SM City Sta. Mesa","Quezon City",14.605,121.017,0),("sucat","SM City Sucat","Parañaque",14.465,120.995,0),
("val","SM City Valenzuela","Valenzuela",14.694,120.968,-1),("south","SM Southmall","Las Piñas",14.433,121.010,-1),("aran","SM Araneta City","Quezon City",14.620,121.054,1),
("aura","SM Aura","Taguig",14.546,121.054,3),("mkt","SM Makati","Makati",14.551,121.031,0),("quiapo","SM Quiapo","Manila",14.598,120.984,0)]
def P(pts): return " ".join(f"{xy(a,b)[0]},{xy(a,b)[1]}" for a,b in pts)
edge=[(14.775,120.99),(14.77,121.05),(14.75,121.09),(14.68,121.12),(14.60,121.125),(14.56,121.10),(14.50,121.07),(14.45,121.06),(14.40,121.05),(14.365,121.04),(14.40,120.99),(14.44,120.965),(14.50,120.985),(14.55,120.978),(14.60,120.965),(14.64,120.955),(14.68,120.935),(14.73,120.945),(14.765,120.965)]
coast=[(14.44,120.965),(14.50,120.985),(14.55,120.978),(14.60,120.965),(14.64,120.955),(14.68,120.935)]
bay=[(14.30,120.90)]+coast+[(14.72,120.90)]
lake=[(14.52,121.13),(14.50,121.07),(14.45,121.06),(14.40,121.05),(14.365,121.04),(14.30,121.04),(14.30,121.13)]
dots=[]
for sid,n,c,la,lo,g in STORES:
    for k in range(random.randint(3,7)):
        dots.append((la+random.uniform(-0.018,0.018),lo+random.uniform(-0.018,0.018),random.random()<0.72))
mx,my=xy(14.585,121.056)
R=[47,95,142]
svg=[f'<svg viewBox="0 0 600 760" role="img" aria-labelledby="map-t map-d"><title id="map-t">Metro Manila network map</title><desc id="map-d">{len(STORES)} SM stores coloured by staffing gap, available cashiers by home area, and travel-time rings around the selected store. The table below the map lists the same information.</desc>',
 '<rect width="600" height="760" fill="#f7f7f7"/>',
 f'<polygon points="{P(bay)}" fill="#dfe6ea"/><text x="40" y="430" font-size="15" fill="#7d8a93" transform="rotate(-72 40 430)">Manila Bay</text>',
 f'<polygon points="{P(lake)}" fill="#dfe6ea"/><text x="470" y="700" font-size="12" fill="#7d8a93">Laguna de Bay</text>',
 f'<polygon points="{P(edge)}" fill="#fff" stroke="#b5b5b5" stroke-dasharray="5 4"/>',
 f'<polyline points="{P([(14.66,121.03),(14.62,121.056),(14.585,121.057),(14.555,121.03),(14.537,120.99)])}" fill="none" stroke="#d6d6d6" stroke-width="6"/><text x="{xy(14.60,121.06)[0]+8}" y="{xy(14.60,121.06)[1]}" font-size="10" fill="#999">EDSA</text>']
for city,la,lo in [("Quezon City",14.70,121.07),("Manila",14.605,120.99),("Makati",14.555,121.02),("Pasig",14.575,121.085),("Taguig",14.52,121.06),("Parañaque",14.475,121.01),("Las Piñas",14.44,120.99),("Muntinlupa",14.40,121.035),("Caloocan",14.74,121.00),("Valenzuela",14.71,120.955),("Marikina",14.645,121.10),("Pasay",14.54,120.995),("Mandaluyong",14.59,121.035)]:
    x,y=xy(la,lo); svg.append(f'<text x="{x}" y="{y}" font-size="10" fill="#aaa" text-anchor="middle">{city}</text>')
svg.append(f'<g id="lyr-rings"><circle id="r45" cx="{mx}" cy="{my}" r="{R[2]}" fill="rgba(0,0,0,.025)" stroke="#888" stroke-dasharray="3 4"/><circle id="r30" cx="{mx}" cy="{my}" r="{R[1]}" fill="rgba(0,0,0,.035)" stroke="#888" stroke-dasharray="3 4"/><circle id="r15" cx="{mx}" cy="{my}" r="{R[0]}" fill="rgba(0,0,0,.05)" stroke="#666"/>'
           f'<text id="t15" x="{mx}" y="{my-R[0]-3}" font-size="10" text-anchor="middle">15 min</text><text id="t30" x="{mx}" y="{my-R[1]-3}" font-size="10" text-anchor="middle">30 min</text><text id="t45" x="{mx}" y="{my-R[2]-3}" font-size="10" text-anchor="middle">45 min</text></g>')
svg.append('<g id="lyr-staff">'+''.join((f'<circle cx="{xy(a,b)[0]}" cy="{xy(a,b)[1]}" r="3.2" fill="#333"/>' if ok else f'<circle cx="{xy(a,b)[0]}" cy="{xy(a,b)[1]}" r="3.2" fill="#fff" stroke="#333"/>') for a,b,ok in dots)+'</g>')
cand=[(14.575,121.045),(14.598,121.066),(14.570,121.070),(14.604,121.048)]
lend=[("aura","mega"),("pasig","mega"),("mnl","sanl"),("aran","nedsa"),("shaw","mega"),("eort","mega")]
L={sid:xy(la,lo) for sid,n,c,la,lo,g in STORES}
svg.append('<g id="lyr-match" style="display:none">'+''.join(f'<line x1="{mx}" y1="{my}" x2="{xy(a,b)[0]}" y2="{xy(a,b)[1]}" stroke="#111" stroke-width="1.5"/>' for a,b in cand)
           +''.join(f'<line x1="{L[f][0]}" y1="{L[f][1]}" x2="{L[t][0]}" y2="{L[t][1]}" stroke="#111" stroke-width="2.5" stroke-dasharray="6 3" marker-end="url(#arr)"/>' for f,t in lend)+'</g>')
svg.insert(1,'<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#111"/></marker></defs>')
pins=''
for sid,n,c,la,lo,g in STORES:
    x,y=xy(la,lo)
    fill='#b3261e' if g<0 else ('#f3e2a6' if g>0 else '#fff'); tc='#fff' if g<0 else '#111'
    lab=f'{g:+d}' if g else '✓'
    state='short by '+str(-g) if g<0 else ('surplus '+str(g) if g>0 else 'balanced')
    pins+=(f'<g class="pin" tabindex="0" role="button" data-store="{sid}" data-name="{n}" data-city="{c}" data-gap="{g}" data-x="{x}" data-y="{y}" aria-label="{n}, {c}: {state} cashiers, Sat Dec 19 1 to 5 PM">'
           f'<circle class="ring-focus" cx="{x}" cy="{y}" r="11" fill="{fill}" stroke="#111" stroke-width="1.5"/><text x="{x}" y="{y+3.5}" font-size="9" font-weight="700" text-anchor="middle" fill="{tc}">{lab}</text>'
           f'<text class="plabel" x="{x+13}" y="{y+3}" font-size="9" fill="#333">{n.replace("SM City ","").replace("SM Center ","").replace("SM ","")}</text></g>')
svg.append(f'<g id="lyr-stores">{pins}</g></svg>')
MAPSVG=''.join(svg)
MAPJS="""<script>
document.addEventListener('DOMContentLoaded',function(){
  var R=[47,95,142];
  function sel(g){var x=+g.dataset.x,y=+g.dataset.y,gap=+g.dataset.gap;
    ['r15','r30','r45'].forEach(function(id,i){var c=document.getElementById(id);c.setAttribute('cx',x);c.setAttribute('cy',y);});
    ['t15','t30','t45'].forEach(function(id,i){var t=document.getElementById(id);t.setAttribute('x',x);t.setAttribute('y',y-R[i]-3);});
    document.getElementById('sel-name').textContent=g.dataset.name+' · '+g.dataset.city;
    document.getElementById('sel-gap').textContent=gap<0?('Needs '+(-gap)+' more cashiers'):(gap>0?('Surplus of '+gap+' — can lend'):'Balanced');
    document.querySelectorAll('.pin circle').forEach(function(c){c.setAttribute('stroke-width','1.5');});
    g.querySelector('circle').setAttribute('stroke-width','4');}
  document.querySelectorAll('.pin').forEach(function(g){g.addEventListener('click',function(){sel(g);});g.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();sel(g);}});});
  document.querySelectorAll('[data-layer]').forEach(function(cb){cb.addEventListener('change',function(){var l=document.getElementById(cb.dataset.layer);if(l)l.style.display=cb.checked?'':'none';});});
  var am=document.getElementById('automatch');if(am)am.addEventListener('click',function(){var l=document.getElementById('lyr-match');var on=l.style.display==='none';l.style.display=on?'':'none';am.setAttribute('aria-pressed',String(on));am.textContent=on?'Hide suggested matches':'Auto-match all gaps';var m=document.getElementById('matchsum');if(m)m.hidden=!on;});
  var tm=document.getElementById('tmode');if(tm)tm.addEventListener('change',function(){var k=tm.value==='car'?[20,40,60]:[15,30,45];['t15','t30','t45'].forEach(function(id,i){document.getElementById(id).textContent=k[i]+' min';});});
  var mega=document.querySelector('.pin[data-store=mega]');if(mega)sel(mega);
});
</script>"""
gaps=sorted([st for st in STORES if st[5]<0],key=lambda t:t[5])
GAPROWS=[[f'<a href="scr-022-roster.html">{n}</a>',c,"Main lanes","Sat 1–5 PM",f'<b>{g}</b>',str(random.randint(3,9)),"SM Aura (+3, 18 min)" if sid=="mega" else "—",'<button class="btn small" data-roles="pln stm">Find cover</button>'] for sid,n,c,la,lo,g in gaps]
page("scr-026-map.html","Network map",[("Plan","scr-020-network.html"),"Network map"],f'''
<div class="row spread"><h1>Network map — Metro Manila</h1><nav class="seg" aria-label="View"><a class="btn small" href="scr-020-network.html">Charts and table</a> <a class="btn small" aria-current="page" href="scr-026-map.html">◉ Map</a></nav></div>
<div class="ctx" role="group" aria-label="Map filters"><div><label for="c-sc2">Scenario</label><select id="c-sc2"><option>★ Christmas 2026 v3 · Published</option></select></div>
<div><label for="mdt">Date</label><input id="mdt" type="date" value="2026-12-19"></div><div><label for="mwin">Time window</label><select id="mwin"><option>1–5 PM</option><option>5–9 PM</option><option>Whole day</option></select></div>
<div><label for="mdep">Department</label><select id="mdep"><option>Main checkout lanes</option><option>All departments</option></select></div>
<div><label for="tmode">Travel by</label><select id="tmode"><option value="commute">Public transport</option><option value="car">Car / motorcycle</option></select></div>
<div><label for="tmax">Max travel</label><select id="tmax"><option>30 min</option><option>15 min</option><option>45 min</option></select></div></div>
<div class="map-layout"><div class="mapbox">{MAPSVG}
<div class="maptools" role="group" aria-label="Layers"><b>Layers</b><label><input type="checkbox" checked data-layer="lyr-stores"> Stores (staffing gap)</label><label><input type="checkbox" checked data-layer="lyr-staff"> Available cashiers (home area)</label><label><input type="checkbox" checked data-layer="lyr-rings"> Travel-time rings</label>
<p><button class="btn small primary" id="automatch" aria-pressed="false" data-roles="pln stm">Auto-match all gaps</button></p></div>
<div class="maplegend"><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#b3261e;border:1px solid #111"></span> Short (−n) · <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#f3e2a6;border:1px solid #111"></span> Surplus (+n) · ○ ✓ Balanced<br>● Available · ○ Near weekly limit · ⇢ Store lends to store · — Offer to cashier<br><span class="muted">Schematic map; store positions approximate. Home areas shown at barangay level.</span></div></div>
<aside><div class="card"><p class="muted">Selected store · Sat Dec 19 · 1–5 PM · Main lanes</p><h2 id="sel-name">SM Megamall · Mandaluyong</h2><p><b id="sel-gap" style="font-size:18px">Needs 4 more cashiers</b><br><span class="muted">26 needed on lanes · 22 rostered</span></p>
<div class="alert info" id="matchsum" hidden role="status">Suggested: 6 moves across 5 stores cover 11 of 14 open shifts. Average travel 21 min. <button class="btn small primary" data-roles="pln">Send all offers</button></div>
<h3 style="font-size:14px">Borrow from a nearby store</h3>
<ul><li>SM Aura · surplus 3 · 18 min <button class="btn small" data-roles="pln stm">Request 3</button></li><li>SM Center Pasig · surplus 2 · 14 min <button class="btn small" data-roles="pln stm">Request 2</button></li></ul>
<h3 style="font-size:14px">Available cashiers within 30 min</h3>
<div class="tablewrap"><table class="cand"><caption class="sr-only">Candidates ranked by travel time</caption><thead><tr><th scope="col"><span class="sr-only">Select</span></th><th scope="col">Cashier</th><th scope="col">Travel</th><th scope="col">Fit</th></tr></thead><tbody>
<tr><td><input type="checkbox" checked aria-label="Select XS-14"></td><th scope="row">XS-14 · home store SM Center Shaw<br><span class="muted">Brgy. Wack-Wack, Mandaluyong · Main, Express</span></th><td>12 min</td><td>✓ 32 of 48 h · rest ok</td></tr>
<tr><td><input type="checkbox" checked aria-label="Select PT-41"></td><th scope="row">PT-41 · SM Center Pasig<br><span class="muted">Brgy. San Antonio, Pasig · Main</span></th><td>16 min</td><td>✓ 18 of 30 h</td></tr>
<tr><td><input type="checkbox" checked aria-label="Select FL-07"></td><th scope="row">FL-07 · Float pool (east)<br><span class="muted">Brgy. Kapitolyo, Pasig · Main, CS</span></th><td>19 min</td><td>✓ float</td></tr>
<tr><td><input type="checkbox" checked aria-label="Select FT-88"></td><th scope="row">FT-88 · SM Araneta City<br><span class="muted">Brgy. Socorro, QC · Main</span></th><td>27 min</td><td>⚠ 6th day in a row</td></tr>
<tr><td><input type="checkbox" aria-label="Select PT-19"></td><th scope="row">PT-19 · SM Aura<br><span class="muted">Brgy. Pinagsama, Taguig · Express</span></th><td>29 min</td><td>⚠ not trained on Main</td></tr></tbody></table></div>
<p class="row"><button class="btn primary" data-roles="pln stm">Offer shift to 4 selected</button><button class="btn">Details</button></p>
<p class="muted">Offers go to cashiers' phones. First to accept gets the shift; offers expire after 30 min. Pay and transport allowance are shown in the offer.</p>
<h3 style="font-size:14px">Offers</h3><ul><li>XS-14 · ✓ Accepted 12:04</li><li>PT-41 · ⏳ Sent 11:58 · expires 12:28</li><li>FL-07 · ✕ Declined</li></ul></div></aside></div>
{table("Stores short of cashiers (list view of the map)",["Store","City","Department","Window","#Gap","#Available ≤30 min","Nearest surplus store","Action"],GAPROWS)}
<p class="wfnote">Uber-style matching: open shifts (demand) are matched to available cashiers (supply) by travel time from their home area, skills and labor-rule eligibility, then offered to their phones. Store-to-store moves (⇢) cover larger gaps. Home areas are opt-in and shown only at barangay level; exact addresses are never stored or shown. On a phone: map and list are view-only; sending an offer and accepting it are allowed.</p>
{MAPJS}''',page_roles="exe pln stm hr",mobile_ro=False)
# ---------- SCR-023 Hiring ----------
page("scr-023-hiring.html","Hiring plan",[("Plan","scr-023-hiring.html"),"Hiring plan"],f'''
<div class="row spread"><h1>Network hiring plan</h1><div class="row"><a class="btn" href="scr-024-summary.html">Leadership summary ›</a><button class="btn">Export ▾</button></div></div>
{ctx(["scenario","region","format","season"],'<div><label for="bl">Baseline</label><select id="bl"><option>October (Oct 5 – Nov 1)</option><option>None</option></select></div>')}
<div class="alert info" role="status">Settings or data changed since this plan was calculated (POS refreshed Sep 28). <button class="btn small primary" data-roles="pln">Recalculate</button></div>
<div class="card" role="status" aria-live="polite"><h2>Run in progress</h2><div class="ph" style="min-height:20px;padding:4px">▓▓▓▓▓▓▓░░░░░ 14 of 24 departments</div><p class="muted">Runs in the background. You can leave this page; we'll notify you when it's done.</p></div>
{kpis([("Seasonal hires needed","284","176 FT · 108 PT · +61%"),("To recruit","313–327","10–15% drop-out buffer"),("Peak-season team","744","vs 463 baseline"),("First hires needed by","Mon Nov 2","recruit from Sep 7"),("Season cashier-hours","147,000","all shifts filled"),("Season cost","₱13.6M","day-type pay · NSD")])}
<div class="grid2"><div class="card"><h2>Seasonal hires by store</h2>{ph("Stacked bars: baseline, FT hires, PT hires by store",240)}</div>
<div class="card"><h2>When to act</h2><ol class="timeline"><li><b>Sep 7</b><span class="pill warn">Overdue</span><span>Start recruiting 313–327</span></li><li><b>Oct 5</b><span class="pill warn">Next week</span><span>Send offers</span></li><li><b>Oct 12</b><span class="pill">Upcoming</span><span>Training (2–3 weeks)</span></li><li><b>Nov 2</b><span class="pill">Wave 1</span><span>56 on the lanes</span></li><li><b>Dec 28</b><span class="pill">Wind down</span><span>End seasonal contracts</span></li></ol></div></div>
{table("Team by store and department",["Store / department","#Baseline team","#Season team","#Seasonal hires","Needed by","Busiest week","#Shifts","#Paid h","#Cost ₱","#FT avg h/wk"],[
["!SM Store – Manila","66","118","52","Nov 2","Dec 14","6,110","32,000","2.9M",""],['<a href="scr-022-roster.html">Kids &amp; toys ›</a>',"14","27","13","Nov 2","Dec 21","1,420","7,400","680k",'<span class="pill warn">38.2</span>']])}
<p class="wfnote">Clicking a department opens its multi-week roster for the season (weeks preset to cover the season).</p>''',page_roles="exe pln stm hr fin")
# ---------- SCR-024 Summary ----------
page("scr-024-summary.html","Leadership summary",[("Plan","scr-023-hiring.html"),"Leadership summary"],f'''
<div class="row spread noprint"><p class="muted">Generated from ★ Christmas 2026 v3 · Published Oct 1 by M. Cruz · Rules 2026.2 · POS as of Sep 28</p><div class="row"><button class="btn" onclick="window.print()">Print / PDF</button><button class="btn">Copy link</button></div></div>
<article class="card"><div class="row spread"><h1>Christmas 2026 cashier hiring plan</h1><span class="pill warn">Illustrative: sample data</span></div>
<p class="muted">8 stores · 24 checkout departments · Season Nov 2 – Dec 31, 2026</p>
<div class="alert"><b>Bottom line:</b> about 284 seasonal cashiers on top of a regular October team of 463 (+61%). Offers need to go out by Monday, October 5.</div>
{kpis([("Seasonal hires","284","176 FT · 108 PT"),("To recruit","313–327","+10–15% drop-out"),("First needed","Nov 2","offers due Oct 5"),("Peak-season team","744","vs 463"),("Season cost","₱13.6M","147,000 paid hours")])}
<div class="grid2"><section><h2>When: action timeline</h2>{ph("Timeline with status pills",160)}</section><section><h2>Where: hires by store</h2>{ph("Table: store, October team, hires, bar, growth, first needed",160)}</section>
<section><h2>Decisions requested</h2><ol><li>Start seasonal recruiting now</li><li>Approve the FT/PT mix</li><li>Fund temporary capacity for Christmas Eve</li><li>Provide real data</li></ol></section>
<section><h2>Risks and trade-offs</h2><ul><li>Lane capacity on Christmas Eve</li><li>Timing</li><li>Under-used staff before the peak</li><li>Stricter labor rules</li></ul></section></div>
<p class="alert info"><b>How to read these numbers.</b> Simulated data for 8 sample stores; assumptions listed from the assumptions register.</p></article>
<div class="card noprint" data-roles="exe"><h2>Your decision</h2><p>This scenario is already published. For a pending one, open <a href="scr-033-approval.html">Approvals</a>.</p></div>''',page_roles="exe pln hr fin")
# ---------- SCR-030 Scenarios ----------
page("scr-030-scenarios.html","Scenarios",[("Scenarios","scr-030-scenarios.html"),"All scenarios"],f'''
<div class="row spread"><h1>Scenarios</h1><a class="btn primary" href="scr-031-scenario-settings.html" data-roles="pln">+ New scenario</a></div>
<div class="ctx" role="search" aria-label="Filter scenarios"><div><label for="sq">Search</label><input id="sq" type="search"></div><div><label for="sst">Status</label><select id="sst"><option>All</option><option>Draft</option><option>Submitted</option><option>Published</option><option>Archived</option></select></div><div><label for="sse">Season</label><select id="sse"><option>Christmas 2026</option></select></div><div><label for="sow">Owner</label><select id="sow"><option>Anyone</option><option>Me</option></select></div><label><input type="checkbox"> Stale only</label></div>
{table("Scenarios",["Name","Status","Season","Rules version","Data as of","Owner","Updated","Actions"],[
['<a href="scr-023-hiring.html">★ Christmas 2026 v3</a>','<span class="pill solid">Published</span>',"Nov 2–Dec 31","2026.2","Sep 20","Ana","Oct 1",'<button class="btn small">Duplicate</button> <a class="btn small" href="scr-032-compare.html">Compare</a>'],
['<a href="scr-031-scenario-settings.html">Christmas 2026 v4</a>','<span class="pill">Submitted</span> <span class="pill warn">Stale</span>',"Nov 2–Dec 31","2026.2","Sep 20","Ana","Oct 3",'<button class="btn small" data-roles="pln">Recalculate</button>'],
['<a href="scr-031-scenario-settings.html">5-day FT rule test</a>','<span class="pill">Draft</span>',"Nov 2–Dec 31","2026.2","Sep 28","Ben","Oct 4",'<button class="btn small" data-roles="pln">Submit</button> <button class="btn small" data-roles="pln">Archive</button>']])}
<p class="wfnote">Store managers see published scenarios only. A stale scenario cannot be submitted until it is recalculated.</p>''',page_roles=PLANR)
# ---------- SCR-031 Settings ----------
page("scr-031-scenario-settings.html","Scenario settings",[("Scenarios","scr-030-scenarios.html"),"5-day FT rule test"],f'''
<div class="row spread"><h1>5-day FT rule test <span class="pill">Draft</span></h1><div class="row" data-roles="pln"><button class="btn">Discard</button><button class="btn">Save</button><button class="btn primary">Save and run</button></div></div>
<p class="alert info" data-roles="exe stm hr fin rst">Read-only for your role.</p>
<div class="grid2" style="grid-template-columns:200px 1fr"><nav aria-label="Settings sections" class="card"><ul><li><a href="#s-dem">Demand</a></li><li><a href="#s-svc">Service and labor</a></li><li><a href="#s-sh">Shift rules</a></li><li><a href="#s-lab">Labor rules</a></li><li><a href="#s-ver">Rules and data</a></li><li><a href="#s-notes">Notes</a></li></ul></nav>
<form><fieldset id="s-dem"><legend>Demand</legend><div class="formgrid"><div><label for="g">Year-on-year growth (%)</label><input id="g" type="number" value="4"></div></div>
<p class="muted">Per-department overrides (baseline transactions, handle time, seasonal uplift) — defaults are learned from POS.</p>
{table("Department overrides",["Department","#Baseline tx/day","#Handle time (min)","#Uplift"],[["QC · Main lanes","1,722","2.5 (learned)","learned"],["Cebu · Main lanes","1,297",'2.7 <span class="pill">edited · default 2.5</span>',"learned"]],False)}</fieldset>
<fieldset id="s-svc"><legend>Service and labor standards</legend><div class="formgrid"><div><label for="a1">Served within target (%)</label><input id="a1" type="number" value="90"></div><div><label for="a2">…this wait (seconds)</label><input id="a2" type="number" value="60"></div><div><label for="a3">Shrinkage</label><input id="a3" type="number" value="1.30"></div><div><label for="a4">Minimum open lanes</label><input id="a4" type="number" value="1"></div><div><label>Hourly base rate</label><p>₱87 — from rules 2026.2 (read-only here)</p></div></div></fieldset>
<fieldset id="s-sh"><legend>Shift rules</legend><div class="formgrid"><div><label for="b1">Full-time shift</label><select id="b1"><option>8 h + 1 h meal</option><option>7 h + 1 h meal</option></select></div><div><label><input type="checkbox" checked> Use part-time peak shifts</label></div><div><label for="b2">Part-time length (h)</label><input id="b2" type="number" value="4"></div><div><label for="b3">Max part-time share (%)</label><input id="b3" type="number" value="40"></div><div><label for="b4">Earliest meal break after (h)</label><input id="b4" type="number" value="3"></div><div><label for="b5">Absence reserve (%)</label><input id="b5" type="number" value="8"></div></div></fieldset>
<fieldset id="s-lab"><legend>Labor rules (roster)</legend><div class="formgrid"><div><label for="c1">FT max days / week</label><input id="c1" type="number" value="5"> <span class="pill">edited · default 6</span></div><div><label for="c2">FT max hours / week</label><input id="c2" type="number" value="40"> <span class="pill">edited · default 48</span></div><div><label for="c3">PT max days</label><input id="c3" type="number" value="5"></div><div><label for="c4">PT max hours</label><input id="c4" type="number" value="30"></div><div><label for="c5">Minimum rest between shifts (h)</label><input id="c5" type="number" value="10"></div><div><label for="c6">Max consecutive days</label><input id="c6" type="number" value="6"></div><div><label><input type="checkbox" checked> Respect preferred rest day</label></div></div></fieldset>
<fieldset id="s-ver"><legend>Rules and data</legend><div class="formgrid"><div><label for="d1">Rules version</label><select id="d1"><option>2026.2 (published Sep 15)</option></select></div><div><label for="d2">Data snapshot</label><select id="d2"><option>POS as of Sep 28 (synthetic)</option></select></div><div><label for="d3">Season</label><select id="d3"><option>Nov 2 – Dec 31</option></select></div><div><label for="d4">Baseline</label><select id="d4"><option>October</option></select></div></div></fieldset>
<fieldset id="s-notes"><legend>Notes</legend><label for="n1">Why this scenario?</label><textarea id="n1">Stricter labor rules per HR guidance.</textarea></fieldset></form></div>''',page_roles=PLANR)
# ---------- SCR-032 Compare ----------
page("scr-032-compare.html","Compare scenarios",[("Scenarios","scr-030-scenarios.html"),"Compare"],f'''
<h1>Compare scenarios</h1>
<div class="ctx"><div><label for="ca">Scenario A</label><select id="ca"><option>★ Christmas 2026 v3 · Published</option></select></div><div><label for="cb">Scenario B</label><select id="cb"><option>5-day FT rule test · Draft</option></select></div><button class="btn">Swap</button></div>
{table("Headline differences",["Measure","#A","#B","#Change"],[["Seasonal hires","284","251","−33"],["Peak-season team","744","799","+55"],["Season cost","₱13.6M","₱14.1M","+₱0.5M"],["First needed by","Nov 2","Nov 2","—"]],False)}
{table("Settings that differ",["Setting","A","B"],[["FT max days / week","6","5"],["FT max hours / week","48","40"],["Cebu main lanes handle time","2.5","2.7"]],False)}
{table("By store",["Store","#Hires A","#Hires B","#Δ","#Cost A","#Cost B"],[["SM Store – Manila","52","47","−5","2.9M","3.0M"]])}''',page_roles="exe pln hr fin")
# ---------- SCR-033 Approval ----------
page("scr-033-approval.html","Approval review",[("Scenarios","scr-030-scenarios.html"),"Approvals","Christmas 2026 v4"],f'''
<h1>Review: Christmas 2026 v4</h1>
<p>Submitted by <b>Ana Reyes</b> on Oct 3 · “Stricter labor rules per HR guidance.”</p>
<section class="card" aria-labelledby="trk"><h2 id="trk">Approval tracker</h2>
<ol class="timeline"><li><b>1 Headcount</b><span class="pill solid">✓ Approved</span><span>HR · L. Tan, Oct 4 — “251 seasonal, OK”</span></li>
<li><b>2 Budget</b><span class="pill solid">✓ Secured</span><span>Recorded outside the system by M. Cruz (Executive), Oct 4 · ref “email 2 Oct” · visible to Finance</span></li>
<li><b>3 Plan</b><span class="pill warn">● Ready</span><span>Executive decision</span></li></ol>
<p class="muted">Sequence: HR headcount and Finance budget (in either order) → Executive plan approval.</p></section>
<div class="card"><h2>Pre-approval checks</h2><ul><li>✓ Run complete</li><li>✓ Not stale</li><li>✓ All shifts filled</li><li>⚠ 2 departments over lane capacity on Dec 24</li></ul></div>
<section class="card" data-roles="hr"><h2>Headcount (your step)</h2>{table("Seasonal hires requested",["Store","#FT","#PT","#Total","#vs published"],[["SM Store – Manila","28","19","47","−5"],["SM Hypermarket – Pampanga","30","17","47","−3"]],False)}</section>
<section class="card" data-roles="fin"><h2>Budget (your step)</h2>{table("Season cost requested",["Store","#Season cost ₱","#vs published"],[["SM Store – Manila","3.0M","+0.1M"],["Network total","13.1M","−0.5M"]],False)}</section>
<div class="grid2" data-roles="exe"><div class="card"><h2>Summary preview</h2>{ph("Embedded leadership summary (SCR-024)",200)}<a href="scr-024-summary.html">Open full summary</a></div>
<div class="card"><h2>Changes vs published plan</h2><p>Hires 284 → 251 · Cost ₱13.6M → ₱13.1M</p><a href="scr-032-compare.html">Full comparison</a></div></div>
<form class="card"><label for="cm">Comment (required to reject or request changes)</label><textarea id="cm"></textarea>
<p class="row" data-roles="hr"><button type="button" class="btn">Request changes</button><button type="button" class="btn primary">Approve headcount</button></p>
<p class="row" data-roles="fin"><button type="button" class="btn">Request changes</button><button type="button" class="btn primary">Approve budget</button></p>
<p class="row" data-roles="exe"><button type="button" class="btn" data-open="outside">Record headcount/budget secured outside the system</button></p>
<p class="row" data-roles="exe"><button type="button" class="btn" data-open="confirm">Reject</button><button type="button" class="btn" data-open="confirm">Request changes</button><button type="button" class="btn primary" data-open="confirm">Approve and publish plan</button></p>
<p class="muted" data-roles="exe">Plan buttons stay disabled until headcount and budget are both secured.</p></form>
<dialog id="outside" aria-labelledby="os-h"><h2 id="os-h">Record as secured outside the system</h2><fieldset><legend>Step</legend><label><input type="checkbox"> Headcount</label> <label><input type="checkbox"> Budget</label></fieldset>
<label for="oref">Reference (e.g. email subject and date)</label><input id="oref" type="text"><label for="onote">Note</label><textarea id="onote"></textarea><p class="muted">HR and Finance are notified and can see this record.</p>
<p class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" data-close>Record</button></p></dialog>
<dialog id="confirm" aria-labelledby="cf-h"><h2 id="cf-h">Approve and publish?</h2><p>“Christmas 2026 v4” replaces “Christmas 2026 v3” as the published plan. HR, Finance, planners, store managers and staff will be notified.</p><p class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" data-close>Approve and publish</button></p></dialog>''',page_roles="exe hr fin",mobile_ro=False)
# ---------- SCR-025 My roster ----------
page("scr-025-my-roster.html","My roster",["My roster"],f'''
<h1>My roster</h1><p class="muted">Maria Santos (PT-02) · SM Supermarket – Quezon City · Main checkout lanes · Part-time, weekdays from 3 PM</p>
<div class="alert info" role="status">✎ Sat Dec 19 changed from 1p–5p to <b>12p–9p</b> by R. Lim (store manager), Dec 18 18:02.</div>
<div class="tabs" role="tablist" aria-label="Week"><button role="tab" aria-selected="true">This week</button><button role="tab" aria-selected="false" tabindex="-1">Next week</button><button role="tab" aria-selected="false" tabindex="-1">Dec 28 – Jan 3</button></div>
{table("Dec 14 – 20",["Day","Shift","Meal","Hours"],[["Mon 14","Rest day","—","—"],["Tue 15 <span class=pill>Payday</span>","3p–7p","—","4"],["Wed 16","Unavailable","—","—"],["Sat 19","12p–9p <span class='pill warn'>Changed</span>","4p","8"]],False)}
<section class="card" aria-labelledby="offers-h"><h2 id="offers-h">Open shift offers near you</h2>
<ul><li><b>SM Megamall · Main lanes</b> · Sat Dec 19 · 1–5 PM · 22 min by public transport · ₱348 + ₱80 transport allowance · expires in 24 min <span class="row"><button class="btn small">Decline</button><button class="btn small primary">Accept</button></span></li></ul>
<p class="muted">Offers only come from stores within your travel limit. You can turn cross-store offers off in Profile.</p></section>
<section class="card" aria-labelledby="req-h"><h2 id="req-h">Requests</h2>
<p class="row"><button class="btn" data-open="tor">Request time off</button><button class="btn" data-open="swr">Request a swap</button></p>
<table><caption class="sr-only">My requests</caption><thead><tr><th>Type</th><th>Detail</th><th>Status</th></tr></thead>
<tbody><tr><td>Time off</td><td>Dec 24 (family)</td><td><span class="pill warn">Pending</span> · store manager</td></tr>
<tr><td>Swap</td><td>Give Sat Dec 19 12p–9p → take Tue open 3p–7p</td><td><span class="pill">Declined</span> — “need cover Sat”</td></tr></tbody></table>
<p class="muted">Requests go to your store manager. Your roster doesn't change until they approve.</p></section>
<dialog id="tor" aria-labelledby="tor-h"><h2 id="tor-h">Request time off</h2><div class="formgrid"><div><label for="tf">From</label><input id="tf" type="date"></div><div><label for="tt">To</label><input id="tt" type="date"></div></div><label for="trn">Reason (optional)</label><textarea id="trn"></textarea><p class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" data-close>Send request</button></p></dialog>
<dialog id="swr" aria-labelledby="swr-h"><h2 id="swr-h">Request a swap</h2><div class="formgrid"><div><label for="sg">Give up my shift</label><select id="sg"><option>Sat Dec 19 · 12p–9p</option><option>Tue Dec 15 · 3p–7p</option></select></div><div><label for="sw2">Take instead</label><select id="sw2"><option>Open shift · Tue Dec 22 · 3p–7p</option><option>Colleague's shift…</option></select></div></div><label for="swn">Note (optional)</label><textarea id="swn"></textarea><p class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" data-close>Send request</button></p></dialog>
<p class="row"><button class="btn">Add to calendar</button></p>
<p class="wfnote">Staff see only their own shifts — no other names or costs.</p>''',page_roles="stf",mobile_ro=False)
# ---------- SCR-040 Notifications ----------
page("scr-040-notifications.html","Notifications",["Notifications"],f'''
<div class="row spread"><h1>Notifications</h1><div class="row"><button class="btn">Mark all read</button><a class="btn" href="scr-080-profile.html#prefs">Preferences</a></div></div>
<div class="tabs" role="tablist" aria-label="Filter notifications"><button role="tab" aria-selected="true">All</button><button role="tab" aria-selected="false" tabindex="-1">Unread (3)</button><button role="tab" aria-selected="false" tabindex="-1">Approvals</button><button role="tab" aria-selected="false" tabindex="-1">Plans</button><button role="tab" aria-selected="false" tabindex="-1">Data</button><button role="tab" aria-selected="false" tabindex="-1">Rules</button></div>
{table("Notifications",["","Event","Object","When","Link"],[["● <span class=sr-only>Unread</span>","⚠ Offers due in 5 days","Christmas 2026 v3","Oct 1","<a href=scr-023-hiring.html>Hiring plan</a>"],["●","ⓘ Run complete","Christmas 2026 v4","Oct 3","<a href=scr-023-hiring.html>Open</a>"],["","✓ POS ingestion succeeded (47,548 rows)","POS hourly","Sep 28","<a href=scr-050-data-sources.html>Data</a>"],["","§ Rule version published: Wage rates 2026.2","Rules","Sep 15","<a href=scr-060-rule-sets.html>Rules</a>"]],False)}
<p class="empty muted">Empty state: “You're all caught up.”</p>''',mobile_ro=False)
# ---------- SCR-041 Search ----------
page("scr-041-search.html","Search results",["Search"],f'''
<h1>Results for “cebu”</h1>
<div class="tabs" role="tablist" aria-label="Result types"><button role="tab" aria-selected="true">All (16)</button><button role="tab" aria-selected="false" tabindex="-1">Stores (1)</button><button role="tab" aria-selected="false" tabindex="-1">Departments (3)</button><button role="tab" aria-selected="false" tabindex="-1">Scenarios (0)</button><button role="tab" aria-selected="false" tabindex="-1">Staff (12)</button><button role="tab" aria-selected="false" tabindex="-1">Pages (0)</button></div>
<section class="card"><h2>Stores</h2><ul><li><a href="scr-020-network.html">SM Supermarket – Cebu City</a> <span class="muted">Visayas · SM Supermarket · opens Network view filtered</span></li></ul></section>
<section class="card"><h2>Departments</h2><ul><li><a href="scr-021-department.html">Main checkout lanes · Cebu City</a></li><li><a href="scr-021-department.html">Express lanes · Cebu City</a></li><li><a href="scr-021-department.html">Customer service · Cebu City</a></li></ul></section>
<section class="card" data-roles="pln stm hr rst"><h2>Staff</h2><ul><li><a href="scr-053-staff.html">FT-03 · Cebu City · Main lanes</a></li><li class="muted">…11 more</li></ul></section>
<p class="wfnote">Results only include objects in the user's scope. No results: “Nothing matches ‘cebu’ in your stores. Check the spelling or search all pages.”</p>''',page_roles="adm exe pln stm hr fin rst",mobile_ro=False)
# ---------- SCR-050 Data sources ----------
page("scr-050-data-sources.html","Data sources",[("Data","scr-050-data-sources.html"),"Data sources"],f'''
<div class="row spread"><h1>Data sources and ingestion</h1><a class="btn primary" href="scr-051-upload.html" data-roles="rst">Upload file</a></div>
{table("Datasets",["Dataset","Source","#Rows","Covers","Last load","Status","Synthetic"],[["POS hourly transactions","Upload","47,548","Aug 1 – Dec 31, 2025","Sep 28","✓ OK",'<span class="pill warn">Yes</span> <button class="btn small" data-roles="rst">Change</button>'],["Stores, departments, lanes","Upload","8 / 24","—","Sep 20","✓ OK",'<span class="pill warn">Yes</span>'],["Staff roster and availability","HRIS (planned)","—","—","—","Not loaded","—"]])}
{table("Ingestion history",["Time","Dataset","User","#Rows","#Warnings","#Errors","Result"],[["Sep 28 14:02","POS hourly","R. Santos","47,548","8","0","✓ Loaded · 3 scenarios marked stale"],["Sep 27 09:40","POS hourly","R. Santos","47,548","8","112","✕ Rejected · <a href=#>error report</a>"]])}''',page_roles="rst pln adm")
# ---------- SCR-051 Upload ----------
page("scr-051-upload.html","Upload and validation",[("Data","scr-050-data-sources.html"),"Upload"],f'''
<h1>Upload data</h1>
<ol class="steps" aria-label="Progress"><li>1 Choose file</li><li>2 Map columns</li><li aria-current="step">3 Validate</li><li>4 Confirm</li></ol>
<div class="card"><h2>Validation results — pos_hourly_2025.csv</h2><ul><li>✓ 47,540 rows valid</li><li>⚠ 8 warnings: lanes open greater than installed lanes (rows 1,204 …)</li><li>✕ 0 errors</li></ul><button class="btn small">Download full report</button></div>
<div class="alert info">Impact: 3 scenarios use the current POS snapshot and will be marked <b>stale</b>. Their owners will be notified.</div>
<fieldset><legend>Dataset flags</legend><label><input type="checkbox" checked> This dataset is synthetic / sample data</label></fieldset>
<p class="row"><a class="btn" href="scr-050-data-sources.html">Cancel</a><button class="btn">Back</button><button class="btn primary">Load data</button></p>''',page_roles="rst")
# ---------- SCR-052 Master ----------
page("scr-052-master-data.html","Stores and lanes",[("Data","scr-050-data-sources.html"),"Stores and lanes"],f'''
<div class="row spread"><h1>Stores, departments and lanes</h1><div class="row" data-roles="rst"><button class="btn">Import</button><button class="btn primary">+ Store</button></div></div>
<div class="ctx"><div><label for="mq">Search</label><input id="mq" type="search"></div><div><label for="mr">Region</label><select id="mr"><option>All</option></select></div><div><label for="mf">Format</label><select id="mf"><option>All</option></select></div></div>
{table("Stores and departments",["Store / department","Format","Region","#Installed lanes","#Default handle time","Trading hours","Active"],[["!SM Supermarket – Quezon City","SM Supermarket","Luzon","48","","9 AM – 10 PM","✓"],["Main checkout lanes","","","30","2.5 min","",'✓ <button class="btn small" data-roles="rst">Edit</button>'],["Express lanes (≤10 items)","","","11","1.2 min","","✓"]])}''',page_roles="exe pln stm hr rst")
# ---------- SCR-053 Staff ----------
page("scr-053-staff.html","Staff and availability",[("Data","scr-050-data-sources.html"),"Staff and availability"],f'''
<div class="row spread"><h1>Staff and availability</h1><div class="row" data-roles="hr"><button class="btn">Import from HRIS / file</button><button class="btn primary">+ Staff</button></div></div>
<div class="ctx"><div><label for="ss">Store</label><select id="ss"><option>SM Supermarket – Quezon City</option></select></div><div><label for="sd">Department</label><select id="sd"><option>All</option></select></div><div><label for="sy">Type</label><select id="sy"><option>All</option><option>Full-time</option><option>Part-time</option></select></div><div><label for="sq2">Search name or ID</label><input id="sq2" type="search"></div></div>
{table("Staff",["ID","Name","Type","Department","Preferred rest","Availability pattern","Unavailable dates","Active"],[['<button class="btn small" data-open="staffp">FT-01</button>',"(name)","Full-time","Main lanes","Mon","Any time","—","✓"],['<button class="btn small" data-open="staffp">PT-02</button>',"(name)","Part-time","Main lanes","—","Student: weekdays from 3 PM","Dec 14","✓"]])}
<dialog id="staffp" class="drawer" aria-labelledby="sp-h"><h2 id="sp-h">PT-02 availability</h2>{ph("Weekly availability grid: day × time window",180)}<label for="ex">Add unavailable date</label><input id="ex" type="date"> <button class="btn small">Add</button><p class="row"><button class="btn" data-close>Close</button><button class="btn primary" data-close>Save</button></p></dialog>
<p class="wfnote">Names are personal data (RA 10173). Store managers only see their own store's staff.</p>''',page_roles="pln stm hr rst")
# ---------- SCR-060 Rule sets ----------
page("scr-060-rule-sets.html","Rule sets",[("Rules","scr-060-rule-sets.html"),"Rule sets"],f'''
<h1>Business rule sets</h1>
<p class="alert info" data-roles="fin">1 cost rule is waiting for your approval before it can be published. <a href="scr-061-rule-editor.html">Review Wage rates 2026.2</a></p>
{table("Rule sets",["Rule set","Cost rule","Current version","Draft","Draft status","#Used by scenarios","Actions"],[["Holiday calendar 2026","No","2026.2","—","—","5",'<button class="btn small" data-roles="rst">New draft</button>'],["Wage rates (by region)","Yes","2026.1","2026.2",'<span class="pill warn">Awaiting Finance</span>','5','<a class="btn small" href="scr-061-rule-editor.html">Review</a>'],["Premium pay multipliers","Yes","2025.1","—","—","5",""],["Planning lead times","No","1.0","—","—","5",""]])}
<p class="muted">Cost rules (wages, premiums, holiday multipliers) need Finance approval before publishing. Non-cost rules (lead times) are published by the Rules Steward directly. Every version is kept; scenarios record the version they used, so a new version never changes existing results.</p>''',page_roles="exe pln hr fin rst")
# ---------- SCR-061 Rule editor ----------
page("scr-061-rule-editor.html","Rule version editor",[("Rules","scr-060-rule-sets.html"),"Wage rates","Draft 2026.2"],f'''
<div class="row spread"><h1>Wage rates · Draft 2026.2 <span class="pill warn">Cost rule</span></h1><div class="row">
<button class="btn" data-roles="rst">Discard</button><button class="btn" data-roles="rst">Save draft</button>
<button class="btn primary" data-roles="rst" data-open="sub">Submit to Finance</button>
<button class="btn" data-roles="fin">Request changes</button><button class="btn primary" data-roles="fin" data-open="pub">Approve and publish</button></div></div>
<section class="card" aria-labelledby="rtrk"><h2 id="rtrk">Approval</h2><ol class="timeline"><li><b>1 Submitted</b><span class="pill solid">✓</span><span>Rules Steward · R. Santos, Oct 3</span></li><li><b>2 Finance approval</b><span class="pill warn">● Pending</span><span>Required before publish (cost rule)</span></li><li><b>3 Published</b><span class="pill">—</span></li></ol><p class="muted">Non-cost rules skip steps 1–2 and publish directly.</p></section>
<div class="row"><label for="ef">Effective from</label><input id="ef" type="date" value="2026-10-01"></div>
{table("Rates",["Region","#Base rate ₱/h","#Was","#Night differential","Wage order reference"],[["NCR / Luzon",'<input type="number" value="90" aria-label="NCR base rate">',"87","10%",'<input type="text" aria-label="NCR reference" value="WO-NCR-26">'],["Visayas",'<input type="number" value="80" aria-label="Visayas base rate">',"78","10%",'<input type="text" aria-label="Visayas reference">']],False)}
<div class="alert info">Impact: 5 scenarios use version 2026.1. On publish they will be marked stale and their owners, Finance and HR notified. <a href="scr-030-scenarios.html">See scenarios</a></div>
<dialog id="sub" aria-labelledby="sb-h"><h2 id="sb-h">Submit to Finance?</h2><p>Wage rates 2026.2 is a cost rule, so Finance must approve it before it can be published. Finance will be notified.</p><p class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" data-close>Submit</button></p></dialog>
<label for="cn">Change note (required)</label><textarea id="cn"></textarea>
<dialog id="pub" aria-labelledby="pb-h"><h2 id="pb-h">Approve and publish Wage rates 2026.2?</h2><p>Finance approval is recorded, then the version goes live. Effective Oct 1, 2026; 5 scenarios will be marked stale. This cannot be undone; a newer version can replace it.</p><p class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" data-close>Approve and publish</button></p></dialog>''',page_roles="rst fin adm",sample=False)
# ---------- SCR-070 Users ----------
page("scr-070-users.html","Users",[("Admin","scr-070-users.html"),"Users"],f'''
<p class="alert info">Demo mode is on: every user can switch roles from the top bar. Assignments below apply when demo mode is off.</p>
<div class="row spread"><h1>Users</h1><a class="btn primary" href="scr-071-user-edit.html">+ Invite user</a></div>
<div class="ctx"><div><label for="uq">Search</label><input id="uq" type="search"></div><div><label for="ur">Role</label><select id="ur"><option>All</option></select></div><div><label for="us">Status</label><select id="us"><option>All</option><option>Active</option><option>Invited</option><option>Deactivated</option></select></div></div>
{table("Users",["Name","Email","Roles","Scope","Last sign-in","Status","Actions"],[["Ana Reyes","ana@1cloudhub.com","Planner","Luzon","Oct 3","Active",'<a class="btn small" href="scr-071-user-edit.html">Edit</a> <button class="btn small" data-open="deact">Deactivate</button>'],["Juan dela Cruz","juan@smretail.com","Store Manager","SM Supermarket – QC","—","Invited",'<button class="btn small">Resend</button>']])}
<dialog id="deact" aria-labelledby="dc-h"><h2 id="dc-h">Deactivate Ana Reyes?</h2><p>She will be signed out and can no longer access the planner. Her scenarios stay available to other planners.</p><p class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" data-close>Deactivate</button></p></dialog>''',page_roles="adm",sample=False)
# ---------- SCR-071 User edit ----------
page("scr-071-user-edit.html","Invite user",[("Admin","scr-070-users.html"),("Users","scr-070-users.html"),"Invite"],f'''
<h1>Invite user</h1>
<form class="card"><div class="formgrid"><div><label for="ue">Work email</label><input id="ue" type="email"><p class="muted">Must end in @smretail.com or @1cloudhub.com</p></div></div>
<fieldset><legend>Roles</legend><label><input type="checkbox"> Executive</label> <label><input type="checkbox" checked> Planner</label> <label><input type="checkbox"> Store Manager</label> <label><input type="checkbox"> HR</label> <label><input type="checkbox"> Finance</label> <label><input type="checkbox"> Rules Steward</label> <label><input type="checkbox"> Staff</label> <label><input type="checkbox"> System Admin</label></fieldset>
<fieldset><legend>Data scope</legend><label><input type="radio" name="sc"> Global</label> <label><input type="radio" name="sc" checked> Region</label> <select aria-label="Region"><option>Luzon</option></select> <label><input type="radio" name="sc"> Store(s)</label> <select aria-label="Stores" multiple size="2"><option>SM Supermarket – QC</option><option>SM Store – Manila</option></select></fieldset>
<p class="row"><a class="btn" href="scr-070-users.html">Cancel</a><button class="btn primary" type="button">Send invitation</button></p></form>''',page_roles="adm",sample=False)
# ---------- SCR-072 Roles ----------
page("scr-072-roles.html","Roles and permissions",[("Admin","scr-070-users.html"),"Roles and permissions"],f'''
<h1>Roles and permissions</h1><p class="muted">Read-only. V view · E edit · A approve · X export · M manage. Scope applies to every cell.</p>
{table("Permission matrix",["Capability","ADM","EXE","PLN","STM","HR","FIN","RST"],[["Network view","—","V X","V X","V own","V X","V X","V"],["Weekly roster","—","V","V E X","V E X","V X","V","—"],["Hiring plan","—","V X","V E X","V own","V X","V X","—"],["Approve hiring plan","—","A","—","—","—","—","—"],["Scenarios","—","V","M","V published","V","V","V"],["Data ingestion","V","—","V","—","—","—","M"],["Business rules","—","V","V","—","V","V","M A"],["Users and roles","M","—","—","—","—","—","—"],["Audit log","V X","—","—","—","—","—","V"]],False)}''',page_roles="adm",sample=False)
# ---------- SCR-073 Audit ----------
page("scr-073-audit.html","Audit log",[("Admin","scr-070-users.html"),"Audit log"],f'''
<div class="row spread"><h1>Audit log</h1><button class="btn">Export CSV</button></div>
<div class="ctx"><div><label for="ad">From</label><input id="ad" type="date"></div><div><label for="ad2">To</label><input id="ad2" type="date"></div><div><label for="au">User</label><select id="au"><option>Anyone</option></select></div><div><label for="at">Event type</label><select id="at"><option>All</option><option>scenario.*</option><option>rules.*</option><option>data.*</option><option>user.*</option><option>export</option></select></div><div><label for="ao">Object</label><input id="ao" type="search"></div></div>
{table("Events",["Time","User","Event","Object","Detail"],[["Oct 3 10:14","Ana Reyes","scenario.submitted","Christmas 2026 v4","—"],["Oct 1 16:30","M. Cruz","scenario.published","Christmas 2026 v3","replaces v2"],["Sep 15 11:02","R. Santos","rules.published","Wage rates 2026.1","NCR 85 → 87"]])}
<p class="wfnote">Rules Stewards see data and rules events only.</p>''',page_roles="adm rst",sample=False)
# ---------- SCR-080 Profile ----------
page("scr-080-profile.html","Profile and preferences",["Profile and preferences"],f'''
<h1>Profile and preferences</h1>
<section class="card"><h2>Profile</h2><p>Juan dela Cruz · juan@smretail.com · Viewing as: <span class="pill">Store Manager</span> (demo mode)</p>
<div class="formgrid"><div><label for="pd">Default store</label><select id="pd"><option>SM Supermarket – QC</option></select></div><div><label for="pl">Language</label><select id="pl"><option>English</option><option>Filipino</option></select></div><div><label>Time zone</label><p>Asia/Manila</p></div></div></section>
<section class="card"><h2>Passkeys</h2>{table("Your passkeys",["Device","Added","Last used","Actions"],[["MacBook (iCloud Keychain)","Sep 20","Today",'<button class="btn small">Remove</button>'],["iPhone","Sep 21","Oct 2",'<button class="btn small">Remove</button>']],False)}<button class="btn">Add a passkey</button><p class="muted">You can't remove your last passkey.</p></section>
<section class="card" data-roles="stf"><h2>Home area and shift offers</h2><p class="muted">Used only to match you to nearby open shifts. We store your barangay, never your address.</p>
<div class="formgrid"><div><label for="hb">Home barangay</label><input id="hb" type="text" value="Brgy. Wack-Wack, Mandaluyong"></div><div><label for="mt">Max travel</label><select id="mt"><option>30 min</option><option>15 min</option><option>45 min</option></select></div></div>
<label><input type="checkbox" checked> Send me open-shift offers from other stores</label> <label><input type="checkbox"> Stop sharing my home area</label></section>
<section class="card" id="prefs"><h2>Notifications</h2>
{table("Notification preferences",["Event","In-app","Email"],[["Approvals (required)","✓ always","✓ always"],["Hiring milestones due / overdue",'<input type="checkbox" checked aria-label="in-app">','<input type="checkbox" checked aria-label="email">'],["Scenario stale",'<input type="checkbox" checked aria-label="in-app">','<input type="checkbox" aria-label="email">'],["Unfilled roster shifts",'<input type="checkbox" checked aria-label="in-app">','<input type="checkbox" checked aria-label="email">']],False)}
<p class="muted">Emails are sent as each event happens (no digest). Turn any non-critical email off above.</p></section>
<button class="btn primary">Save</button>''',sample=False,mobile_ro=False)

# ---------- SCR-090 Error and status pages ----------
page("scr-090-error.html","Error and status pages",["Error and status pages"],f'''
<h1>Error and status pages</h1><p class="muted">Every request-level error has a plain-language message, a reference ID where relevant, and a clear way back to safety. Tabs preview each page.</p>
<div class="tabs" role="tablist" aria-label="Error states"><button role="tab" aria-selected="true">404</button><button role="tab" aria-selected="false" tabindex="-1">403</button><button role="tab" aria-selected="false" tabindex="-1">401</button><button role="tab" aria-selected="false" tabindex="-1">500 / 503</button><button role="tab" aria-selected="false" tabindex="-1">429</button><button role="tab" aria-selected="false" tabindex="-1">Offline</button></div>
<section class="card" style="text-align:center"><p style="font-size:40px" aria-hidden="true">🧭</p><h2>Page not found (404)</h2><p>We couldn't find that page. It may have moved.</p><p class="row" style="justify-content:center"><a class="btn primary" href="scr-010-home.html">Go to Home</a><a class="btn" href="scr-041-search.html">Search</a></p></section>
<div class="grid2">
<div class="card"><h2>403 No access</h2><p>You're signed in, but this is outside your role or stores. Nothing about it is shown.</p><a class="btn" href="scr-010-home.html">Go to Home</a></div>
<div class="card"><h2>401 Not signed in</h2><p>Your session ended. Sign in to continue where you left off.</p><a class="btn primary" href="scr-001-sign-in.html">Sign in</a></div>
<div class="card"><h2>500 / 503 Something went wrong</h2><p>A problem on our side. Try again in a moment.</p><p class="muted">Reference: <code>err-3f9a2c</code></p><p class="row"><button class="btn">Try again</button><a class="btn" href="scr-010-home.html">Go to Home</a></p></div>
<div class="card"><h2>429 Too many requests</h2><p>You've done that a lot in a short time. Try again shortly.</p><button class="btn">Try again</button></div>
<div class="card"><h2>Offline</h2><p>Can't reach the server. Your unsaved work is kept.</p><button class="btn">Retry</button></div></div>
<p class="wfnote">Authenticated errors use the app shell (Home is one click); 401 and pre-auth 500 use the bare layout. Announced to assistive tech; localised (en/fil); no stack traces or object details.''',mobile_ro=False)
# ---------- SCR-091 Help and shortcuts ----------
page("scr-091-help.html","Help and shortcuts",["Help and shortcuts"],f'''
<h1>Help and keyboard shortcuts</h1>
<div class="grid2">
<section class="card"><h2>Keyboard shortcuts</h2>{table("Shortcuts",["Keys","Action"],[["/ or ⌘K","Focus search"],["?","Open this shortcut reference"],["g then h","Go to Home"],["g then r","Go to Roster"],["g then m","Go to Network map"],["n","Open notifications"],["Esc","Close a dialog or menu"],["← →","Move between shifts on the timeline"],["Enter","Open the focused shift"]],False)}<p class="muted">Shortcuts are off while typing in a field and never trap focus. Everything is also reachable by pointer.</p></section>
<section class="card"><h2>Help</h2><ul><li><a href="#">Quick start for your role</a></li><li><a href="#">How staffing is calculated (methodology)</a></li><li><a href="#">How cross-store matching ranks people</a></li><li><a href="#">Approval sequence: headcount, budget, plan</a></li><li><a href="#">Contact support</a></li></ul><p class="muted">In-context "How it works" panels appear on complex screens (Erlang C inputs, matching, approvals).</p></section></div>
<p class="wfnote">Opened from the user menu or the ? key. Content is localised (en/fil).''',mobile_ro=False)

# ---------- Auth pages (no shell) ----------
def bare(fname,title,body):
    open(fname,"w").write(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} — Wireframe</title><link rel="stylesheet" href="wireframe.css"><script src="wireframe.js" defer></script></head><body><main id="main" style="max-width:560px;margin:48px auto">{body}</main></body></html>''')
bare("scr-001-sign-in.html","Sign in",'''<p class="crumbs"><a href="index.html">Screen map</a></p>
<div class="tabs" role="tablist" aria-label="Wireframe states"><button role="tab" aria-selected="true" aria-controls="st1">Default</button><button role="tab" aria-selected="false" tabindex="-1" aria-controls="st2">Domain not allowed</button><button role="tab" aria-selected="false" tabindex="-1" aria-controls="st3">Passkey failed</button><button role="tab" aria-selected="false" tabindex="-1" aria-controls="st4">Session expired</button><button role="tab" aria-selected="false" tabindex="-1" aria-controls="st5">No passkey support</button></div>
<div class="card"><h1 style="text-align:center">SM Cashier Planner</h1>
<div id="st2" role="tabpanel" hidden><p class="alert" role="alert">This work email domain isn't allowed. Use an @smretail.com or @1cloudhub.com address.</p></div>
<div id="st3" role="tabpanel" hidden><p class="alert" role="alert">The passkey prompt was cancelled or didn't work. Try again, or set up a passkey on this device with an email code.</p></div>
<div id="st4" role="tabpanel" hidden><p class="alert info">You were signed out after 60 minutes of inactivity. Unsaved changes were kept as a draft.</p></div>
<div id="st5" role="tabpanel" hidden><p class="alert">This browser doesn't support passkeys. Use a current version of Chrome, Edge, Safari or Firefox.</p></div>
<div id="st1" role="tabpanel"></div>
<label for="em">Work email</label><input id="em" type="email" value="juan@smretail.com" style="width:100%">
<p><a class="btn primary" href="scr-010-home.html" style="width:100%;text-align:center">Sign in with a passkey</a></p>
<p><a href="scr-002-first-sign-in.html">New here, or no passkey on this device? Set one up →</a></p>
<p class="muted">Only smretail.com and 1cloudhub.com accounts. No passwords — you sign in with Face ID, fingerprint or your device PIN.</p></div>
<p class="wfnote">Amazon Cognito user pool, passkey (WebAuthn) sign-in. The session-timeout warning appears inside the app 2 minutes before timeout.</p>''')
bare("scr-002-first-sign-in.html","First sign-in",'''<p class="crumbs"><a href="index.html">Screen map</a></p><div class="card"><h1>Set up your passkey</h1>
<ol class="steps" aria-label="Progress"><li>1 Verify email</li><li aria-current="step">2 Create passkey</li><li>3 Get started</li></ol>
<section><h2>1 Verify your email</h2><p>We sent a 6-digit code to juan@smretail.com.</p><label for="otp">Code</label><input id="otp" type="text" inputmode="numeric" autocomplete="one-time-code"> <button class="btn small">Resend</button></section>
<section><h2>2 Create a passkey</h2><p>Your device will ask for Face ID, fingerprint or PIN.</p><button class="btn primary">Create passkey</button></section>
<section><h2>3 Get started</h2><div class="formgrid"><div><label for="sr">Start as (demo mode — switch any time)</label><select id="sr"><option>Planner</option><option>Executive</option><option>Store Manager</option><option>HR</option><option>Finance</option><option>Rules Steward</option><option>Staff</option><option>System Admin</option></select></div></div>
<fieldset><legend>Notifications</legend><label><input type="checkbox" checked> In-app</label> <label><input type="checkbox" checked> Email for approvals and shift changes</label></fieldset></section>
<p><a class="btn primary" href="scr-010-home.html">Continue</a></p></div>''')

# ---------- Index ----------
screens=[("SCR-001","scr-001-sign-in.html","Sign in (+ states)","All"),("SCR-002","scr-002-first-sign-in.html","First sign-in","All"),("SCR-010","scr-010-home.html","Home (role variants)","All"),
("SCR-020","scr-020-network.html","Network view","EXE PLN STM HR FIN RST"),("SCR-021","scr-021-department.html","Department day plan","EXE PLN STM HR FIN RST"),("SCR-022","scr-022-roster.html","Roster (Day timeline / Week grid / Month)","EXE PLN STM HR FIN"),
("SCR-023","scr-023-hiring.html","Hiring plan","EXE PLN STM HR FIN"),("SCR-024","scr-024-summary.html","Leadership summary","EXE PLN HR FIN"),("SCR-025","scr-025-my-roster.html","My roster + offers + requests","STF"),("SCR-026","scr-026-map.html","Network map (Metro Manila)","EXE PLN STM HR"),("SCR-030","scr-030-scenarios.html","Scenario list","All but ADM"),
("SCR-031","scr-031-scenario-settings.html","Scenario settings","PLN (edit)"),("SCR-032","scr-032-compare.html","Compare scenarios","EXE PLN HR FIN"),("SCR-033","scr-033-approval.html","Approval review (HR / Finance / Executive)","EXE HR FIN"),
("SCR-040","scr-040-notifications.html","Notifications","All"),("SCR-041","scr-041-search.html","Search results","All"),("SCR-050","scr-050-data-sources.html","Data sources and ingestion","RST PLN ADM"),
("SCR-051","scr-051-upload.html","Upload and validation","RST"),("SCR-052","scr-052-master-data.html","Stores, departments, lanes","EXE PLN STM HR RST"),("SCR-053","scr-053-staff.html","Staff and availability","PLN STM HR RST"),
("SCR-060","scr-060-rule-sets.html","Rule sets","EXE PLN HR FIN RST"),("SCR-061","scr-061-rule-editor.html","Rule version editor (Finance approves cost rules)","RST FIN"),("SCR-070","scr-070-users.html","Users","ADM"),
("SCR-071","scr-071-user-edit.html","Invite / edit user","ADM"),("SCR-072","scr-072-roles.html","Roles and permissions","ADM"),("SCR-073","scr-073-audit.html","Audit log","ADM RST"),("SCR-080","scr-080-profile.html","Profile and preferences","All"),
("SCR-090","scr-090-error.html","Error and status pages (4xx/5xx, offline)","All"),("SCR-091","scr-091-help.html","Help and keyboard shortcuts","All")]
rows="".join(f'<tr><th scope="row">{i}</th><td><a href="{f}">{n}</a></td><td>{r}</td></tr>' for i,f,n,r in screens)
journeys=[("J1 Headcount, budget and plan approval","HR: SCR-033 approve headcount · Finance: SCR-033 approve budget (or Executive records either as secured outside) → Executive: SCR-033 → SCR-024 → Approve"),("J2 Planner refreshes a plan","SCR-040 → SCR-030 → SCR-031 → SCR-023 → SCR-032 → Submit"),("J3 Capacity investigation","SCR-010 → SCR-020 heatmap → SCR-021 → Adjust settings"),
("J4 Store manager emergency off","Home (STM) → SCR-022 → shift cell → Emergency off → pick replacement → Save"),("J5 HR recruiting","SCR-040 → SCR-023 timeline → Export → SCR-053"),("J6 Rules steward publishes wages","SCR-060 → SCR-061 → Publish → SCR-030 (stale)"),("J7 First passkey sign-in","SCR-001 → SCR-002 (email code, create passkey, starting role) → SCR-010"),("J8 Staff checks roster","Notification → SCR-025 (phone)"),("J10 Cover a gap from nearby staff","SCR-022 open shift → SCR-026 map → pick candidates / borrow from store → offers → staff accepts on SCR-025 → roster shows borrowed cashier")]
jr="".join(f'<li><b>{a}</b>: {b}</li>' for a,b in journeys)
open("index.html","w").write(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Screen map — Cashier Staffing Planner wireframes</title><link rel="stylesheet" href="wireframe.css"></head>
<body><main id="main" style="max-width:1000px;margin:24px auto;padding:0 16px"><h1>Cashier Staffing Planner — wireframes</h1>
<p class="wfnote">Low-fi, grayscale, structural only. Use “Viewing as” in the top bar (demo mode) to switch between the 8 roles. On a phone most screens are read-only; approvals, emergency offs and My roster stay interactive. Design: <code>../design.md</code>.</p>
<h2>Journeys</h2><ul>{jr}</ul>
<div class="tablewrap"><table><caption>Screens</caption><thead><tr><th scope="col">ID</th><th scope="col">Screen</th><th scope="col">Roles</th></tr></thead><tbody>{rows}</tbody></table></div>
<h2>Breakpoints</h2><p>Mobile &lt;600 · Tablet 600–1023 · Laptop 1024–1439 · Desktop ≥1440. Resize the browser to check each layout.</p></main></body></html>''')
print("pages written")
