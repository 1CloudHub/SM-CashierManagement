// Wireframe-only behaviour: role preview, menus, tabs, dialogs, nav drawer. No dependencies.
(function(){
  var ROLE_KEY='wf-role';
  function applyRole(role){
    document.body.dataset.role=role;
    document.querySelectorAll('[data-roles]').forEach(function(el){
      var ok=el.getAttribute('data-roles').split(' ').indexOf(role)>-1;
      el.hidden=!ok;
    });
    var page=document.body.getAttribute('data-page-roles');
    var na=document.getElementById('noaccess'), content=document.getElementById('content');
    if(page&&na&&content){var allowed=page.split(' ').indexOf(role)>-1;na.hidden=allowed;content.hidden=!allowed;}
    var sel=document.getElementById('role'); if(sel) sel.value=role;
  }
  document.addEventListener('DOMContentLoaded',function(){
    var role=localStorage.getItem(ROLE_KEY)||'pln';
    applyRole(role);
    var sel=document.getElementById('role');
    if(sel) sel.addEventListener('change',function(){localStorage.setItem(ROLE_KEY,sel.value);applyRole(sel.value);});
    // dropdown menus
    document.querySelectorAll('[aria-haspopup][aria-controls]').forEach(function(btn){
      var pop=document.getElementById(btn.getAttribute('aria-controls'));
      btn.addEventListener('click',function(e){e.stopPropagation();var open=btn.getAttribute('aria-expanded')==='true';
        document.querySelectorAll('[aria-haspopup][aria-expanded=true]').forEach(function(b){b.setAttribute('aria-expanded','false');document.getElementById(b.getAttribute('aria-controls')).hidden=true;});
        btn.setAttribute('aria-expanded',String(!open));pop.hidden=open;});
    });
    document.addEventListener('click',function(e){document.querySelectorAll('[aria-haspopup][aria-expanded=true]').forEach(function(b){var p=document.getElementById(b.getAttribute('aria-controls'));if(!p.contains(e.target)){b.setAttribute('aria-expanded','false');p.hidden=true;}});});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'){document.querySelectorAll('[aria-haspopup][aria-expanded=true]').forEach(function(b){b.setAttribute('aria-expanded','false');document.getElementById(b.getAttribute('aria-controls')).hidden=true;b.focus();});}
      if((e.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))||(e.key==='k'&&(e.metaKey||e.ctrlKey))){var s=document.getElementById('q');if(s){e.preventDefault();s.focus();}}});
    // tabs
    document.querySelectorAll('[role=tablist]').forEach(function(list){
      var tabs=list.querySelectorAll('[role=tab]');
      tabs.forEach(function(t){t.addEventListener('click',function(){tabs.forEach(function(x){x.setAttribute('aria-selected','false');x.tabIndex=-1;var p=document.getElementById(x.getAttribute('aria-controls'));if(p)p.hidden=true;});
        t.setAttribute('aria-selected','true');t.tabIndex=0;var p=document.getElementById(t.getAttribute('aria-controls'));if(p)p.hidden=false;});
        t.addEventListener('keydown',function(e){var i=[].indexOf.call(tabs,t);if(e.key==='ArrowRight'||e.key==='ArrowLeft'){var n=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];n.focus();n.click();}});});
    });
    // dialogs
    document.querySelectorAll('[data-open]').forEach(function(b){b.addEventListener('click',function(){var d=document.getElementById(b.dataset.open);if(d)d.showModal();});});
    document.querySelectorAll('[data-close]').forEach(function(b){b.addEventListener('click',function(){b.closest('dialog').close();});});
    // mobile nav + search
    var mt=document.getElementById('menu-toggle'),nav=document.getElementById('sidenav');
    if(mt&&nav) mt.addEventListener('click',function(){var o=nav.classList.toggle('open');mt.setAttribute('aria-expanded',String(o));});
    var st=document.getElementById('search-toggle'),sf=document.getElementById('searchform');
    if(st&&sf) st.addEventListener('click',function(){sf.classList.toggle('open');var q=document.getElementById('q');if(q)q.focus();});
    // mobile read-only: disable editing controls (filters in the context bar stay usable)
    var mq=window.matchMedia('(max-width:599px)');
    function ro(){if(!document.body.hasAttribute('data-mobile-ro'))return;var c=document.getElementById('content');if(!c)return;
      c.querySelectorAll('input,select,textarea,button').forEach(function(el){if(el.closest('.ctx')||el.closest('[role=tablist]')||el.closest('.tablewrap caption')||/View as table|Export|Saved views|View settings/.test(el.textContent||''))return;
        if(mq.matches){el.setAttribute('data-ro','1');el.disabled=true;}else if(el.getAttribute('data-ro')){el.disabled=false;el.removeAttribute('data-ro');}});
      c.querySelectorAll('a.btn.primary').forEach(function(a){a.style.display=mq.matches?'none':'';});}
    ro(); if(mq.addEventListener) mq.addEventListener('change',ro);
    // bulk selection bar (timeline)
    function bulk(){var n=document.querySelectorAll('input[data-select]:checked').length,b=document.getElementById('bulkbar');if(!b)return;b.hidden=n===0;var c=document.getElementById('bulkcount');if(c)c.textContent=n+(n===1?' shift':' shifts')+' selected';}
    document.querySelectorAll('input[data-select]').forEach(function(i){i.addEventListener('change',bulk);});
    var sa=document.getElementById('selectall');if(sa)sa.addEventListener('change',function(){document.querySelectorAll('input[data-select]').forEach(function(i){i.checked=sa.checked;});bulk();});
    var bc=document.getElementById('bulkclear');if(bc)bc.addEventListener('click',function(){document.querySelectorAll('input[data-select]').forEach(function(i){i.checked=false;});bulk();});
    // department legend filters (week grid, timeline)
    document.querySelectorAll('input[data-filter-dept]').forEach(function(i){i.addEventListener('change',function(){document.querySelectorAll('[data-dept="'+i.dataset.filterDept+'"]').forEach(function(el){el.style.visibility=i.checked?'':'hidden';});});});
    // sort buttons (visual only)
    document.querySelectorAll('th button.sort').forEach(function(b){b.addEventListener('click',function(){var th=b.parentElement;var cur=th.getAttribute('aria-sort');
      th.closest('tr').querySelectorAll('th').forEach(function(x){x.removeAttribute('aria-sort');});th.setAttribute('aria-sort',cur==='ascending'?'descending':'ascending');});});
    // roster cell toggle (J4)
    document.querySelectorAll('[data-toggle-unavail]').forEach(function(b){b.addEventListener('click',function(){var on=b.getAttribute('aria-pressed')==='true';b.setAttribute('aria-pressed',String(!on));b.textContent=on?b.dataset.shift:'Unavailable';
      var w=document.getElementById('reroster');if(w)w.hidden=false;});});
  });
})();
// Theme toggle (light/dark value swap). Early restore runs inline in <head>.
(function(){
  document.addEventListener('DOMContentLoaded',function(){
    var b=document.getElementById('theme-toggle');if(!b)return;
    function cur(){var t=document.documentElement.dataset.theme;if(t)return t;return window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
    function sync(){b.setAttribute('aria-pressed',String(cur()==='dark'));}
    sync();
    b.addEventListener('click',function(){var n=cur()==='dark'?'light':'dark';document.documentElement.dataset.theme=n;try{localStorage.setItem('wf-theme',n);}catch(e){}sync();});
  });
})();
