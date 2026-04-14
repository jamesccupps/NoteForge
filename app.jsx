const {useState,useEffect,useRef,useCallback,useMemo}=React;

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════ */
const NB_COLORS=["#7c6ef0","#e05a9f","#e89020","#1cb888","#3b82f6","#9061e0","#e54545","#14b8a6","#d96830","#64748b"];
const FONT_SIZES=[{l:"10",v:"1"},{l:"12",v:"2"},{l:"14",v:"3"},{l:"16",v:"4"},{l:"18",v:"5"},{l:"24",v:"6"},{l:"32",v:"7"}];
const HEADINGS=[{l:"Normal",v:"div"},{l:"H1",v:"h1"},{l:"H2",v:"h2"},{l:"H3",v:"h3"},{l:"H4",v:"h4"}];
const TXT_COLORS=["#000000","#374151","#dc2626","#ea580c","#ca8a04","#16a34a","#2563eb","#7c3aed","#db2777","#ffffff"];
const HL_COLORS=["transparent","#fef08a","#bbf7d0","#bfdbfe","#e9d5ff","#fecdd3","#fed7aa","#ccfbf1","#e2e8f0"];
const uid=()=>"id-"+Date.now().toString(36)+Math.random().toString(36).substr(2,6);

const THEMES={
  dark:{
    "--bg":"#0e0e16","--surface":"#161622","--surface-alt":"#1c1c2c",
    "--border":"#282840","--border-light":"#32324a",
    "--text":"#e4e4f0","--text-secondary":"#8585a0","--text-muted":"#52526a",
    "--accent":"#7c6ef0","--accent-bg":"rgba(124,110,240,.12)","--accent-hover":"#6359d0",
    "--hover":"rgba(255,255,255,.04)","--shadow":"rgba(0,0,0,.5)",
    "--editor-bg":"#111119","--code-bg":"#1a1a28",
    "--scrollbar":"#32324a","--scrollbar-hover":"#444468",
    "--danger":"#f87171","--success":"#34d399","--warning":"#fbbf24",
    "--nav-bg":"#111118",
  },
  light:{
    "--bg":"#f6f5f0","--surface":"#ffffff","--surface-alt":"#f0efe8",
    "--border":"#ddd8ce","--border-light":"#eae6dc",
    "--text":"#1a1a1a","--text-secondary":"#606058","--text-muted":"#9a9a88",
    "--accent":"#6359d0","--accent-bg":"rgba(99,89,208,.09)","--accent-hover":"#4f42b5",
    "--hover":"rgba(0,0,0,.035)","--shadow":"rgba(0,0,0,.06)",
    "--editor-bg":"#fcfcfa","--code-bg":"#f0efe8",
    "--scrollbar":"#c8c4b8","--scrollbar-hover":"#a8a498",
    "--danger":"#e54545","--success":"#1cb888","--warning":"#e89020",
    "--nav-bg":"#eceade",
  }
};

const DEFAULT_DATA={notebooks:[{
  id:"nb-1",name:"My Notebook",color:"#7c6ef0",sections:[{
    id:"sec-1",name:"General",color:"#7c6ef0",pages:[{
      id:"page-1",title:"Welcome to NoteForge",
      content:`<h2>Welcome to NoteForge</h2>
<p>Your encrypted, offline note-taking app.</p>
<h3>Features</h3>
<ul>
<li><strong>AES-256 encryption</strong> — protect all notes with a master password</li>
<li><strong>Notebook locks</strong> — individual password per notebook</li>
<li>Rich text: <strong>bold</strong>, <em>italic</em>, <u>underline</u>, <s>strike</s></li>
<li>Headings, lists, tables, code blocks, links</li>
<li>Paste images, checklists, find &amp; replace</li>
</ul>
<h3>Shortcuts</h3>
<ul>
<li><code>Ctrl+B/I/U</code> — Bold/Italic/Underline</li>
<li><code>Ctrl+F</code> — Find &amp; Replace</li>
<li><code>Ctrl+D</code> — Duplicate page</li>
<li><code>Ctrl+P</code> — Print</li>
<li><code>Ctrl+Shift+E</code> — Export HTML</li>
</ul>
<p>Go to <strong>File → Encryption Settings</strong> to enable master encryption.</p>`,
      created:Date.now(),modified:Date.now(),pinned:false,deleted:false
    }]
  }]
}]};

/* ═══════════════════════════════════════════════════════════════
   STORAGE
   ═══════════════════════════════════════════════════════════════ */
const store={
  async get(){
    try{
      if(window.electronAPI)return await window.electronAPI.storageGet();
      const v=localStorage.getItem("noteforge-data");
      return v?{value:v}:null;
    }catch{return null}
  },
  async set(val){
    try{
      if(window.electronAPI)return await window.electronAPI.storageSet(val);
      localStorage.setItem("noteforge-data",val);return true;
    }catch{return false}
  }
};
const prefsStore={
  load(){try{return JSON.parse(localStorage.getItem("noteforge-prefs")||"{}")}catch{return{}}},
  save(p){try{localStorage.setItem("noteforge-prefs",JSON.stringify(p))}catch{}}
};

/* ═══════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════ */
const snippet=(html)=>html?html.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,80):"";
const escHtml=(s)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const hasElectronCrypto=()=>!!(window.electronAPI?.checkEncryption);

/* ── HTML Sanitization (DOMPurify) ─────────────────────────────
   Strips script tags, event handlers, javascript: URLs, etc.
   Applied before any HTML is set as innerHTML. */
const sanitizeHTML=(html)=>{
  if(!html)return html;
  if(window.DOMPurify){
    return window.DOMPurify.sanitize(html,{
      ALLOWED_TAGS:["h1","h2","h3","h4","p","br","strong","b","em","i","u","s","del",
        "ul","ol","li","blockquote","pre","code","table","thead","tbody","tr","td","th",
        "a","img","hr","div","span","label","input","sub","sup","font"],
      ALLOWED_ATTR:["href","src","title","alt","style","class","id","type","checked",
        "for","color","size","face","target","width","height","colspan","rowspan"],
      FORBID_TAGS:["script","iframe","object","embed","form","textarea","select","button","meta","link","base"],
      FORBID_ATTR:["onerror","onload","onclick","onmouseover","onfocus","onblur","onchange",
        "onsubmit","onkeydown","onkeyup","onkeypress","onmousedown","onmouseup"],
      ALLOW_DATA_ATTR:false,
    });
  }
  // Fallback if DOMPurify not loaded — strip obvious dangerous patterns
  return html
    .replace(/<script[\s\S]*?<\/script>/gi,"")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi,"")
    .replace(/<object[\s\S]*?<\/object>/gi,"")
    .replace(/<embed[\s\S]*?>/gi,"")
    .replace(/\bon\w+\s*=/gi,"data-removed=")
    .replace(/javascript\s*:/gi,"removed:");
};

/* ── CRITICAL: Sanitize data before ANY write to disk ──────────
   Strips plaintext sections from ALL locked notebooks.
   This is the mandatory safety net — no conditions, no exceptions.
   Called by persist() and the beforeunload emergency flush. */
function sanitizeForDiskSync(data){
  if(!data?.notebooks)return data;
  return{...data,notebooks:data.notebooks.map(nb=>{
    if(!nb.locked)return nb;
    // Locked notebook: NEVER write plaintext sections to disk
    return{...nb,sections:[]};
  })};
}

/* ═══════════════════════════════════════════════════════════════
   SVG ICONS
   ═══════════════════════════════════════════════════════════════ */
function I({n,s=16}){
  const p={
    book:<><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></>,
    folder:<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>,
    file:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></>,
    plus:<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    search:<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    trash:<><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></>,
    pin:<><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24z"/></>,
    bold:<><path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/></>,
    italic:<><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></>,
    underline:<><path d="M6 3v7a6 6 0 006 6 6 6 0 006-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></>,
    strike:<><path d="M16 4H9a3 3 0 00-3 3v0a3 3 0 003 3h0"/><path d="M8 20h7a3 3 0 003-3v0a3 3 0 00-3-3h0"/><line x1="4" y1="12" x2="20" y2="12"/></>,
    ul:<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></>,
    ol:<><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="3" y="8" fontSize="8" fill="currentColor" stroke="none">1</text><text x="3" y="14" fontSize="8" fill="currentColor" stroke="none">2</text><text x="3" y="20" fontSize="8" fill="currentColor" stroke="none">3</text></>,
    check:<><polyline points="9,11 12,14 22,4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></>,
    undo:<><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></>,
    redo:<><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 11-2.13-9.36L23 10"/></>,
    moon:<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>,
    sun:<><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>,
    chev:<polyline points="9,18 15,12 9,6"/>,
    edit:<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    x:<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    code:<><polyline points="16,18 22,12 16,6"/><polyline points="8,6 2,12 8,18"/></>,
    hr:<line x1="2" y1="12" x2="22" y2="12"/>,
    indent:<><line x1="21" y1="6" x2="11" y2="6"/><line x1="21" y1="12" x2="11" y2="12"/><line x1="21" y1="18" x2="11" y2="18"/><polyline points="3,8 7,12 3,16"/></>,
    outdent:<><line x1="21" y1="6" x2="11" y2="6"/><line x1="21" y1="12" x2="11" y2="12"/><line x1="21" y1="18" x2="11" y2="18"/><polyline points="7,8 3,12 7,16"/></>,
    sidebar:<><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></>,
    table:<><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></>,
    wrap:<><path d="M3 6h18"/><path d="M3 12h15a3 3 0 110 6h-4"/><polyline points="13,15 11,18 13,21"/><path d="M3 18h4"/></>,
    zin:<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></>,
    zout:<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></>,
    palette:<><circle cx="13.5" cy="6.5" r="2"/><circle cx="17.5" cy="10.5" r="2"/><circle cx="8.5" cy="7.5" r="2"/><circle cx="6.5" cy="12" r="2"/><path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.2-.64-1.67-.08-.1-.13-.21-.13-.33 0-.28.22-.5.5-.5H16c3.31 0 6-2.69 6-6 0-5.51-4.49-10-10-10z"/></>,
    hl:<><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></>,
    dl:<><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
    link:<><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></>,
    quote:<><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2.017-2-2H5c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2.017-2-2h-3c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></>,
    print:<><polyline points="6,9 6,2 18,2 18,9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>,
    copy:<><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></>,
    eraser:<><path d="M7 21h10"/><path d="M5.5 13.5L12 7l5 5-6.5 6.5a2.12 2.12 0 01-3 0L5.5 16.5a2.12 2.12 0 010-3z"/><path d="M18 13l-1.5-1.5"/></>,
    scissors:<><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></>,
    clipboard:<><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></>,
    lock:<><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></>,
    unlock:<><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 019.9-1"/></>,
    shield:<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
  };
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{p[n]}</svg>;
}

/* ═══════════════════════════════════════════════════════════════
   SMALL COMPONENTS
   ═══════════════════════════════════════════════════════════════ */
function Btn({icon,label,onClick,active,disabled,s=14}){
  return <button title={label} onClick={onClick} disabled={disabled}
    className={`tb${active?" active":""}`}><I n={icon} s={s}/></button>;
}
function Sel({value,opts,onChange,w=80}){
  return <select className="nf-select" value={value} onChange={e=>onChange(e.target.value)} style={{width:w}}>
    {opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
  </select>;
}
function CPick({colors,onChange,label}){
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{
    if(!open)return;
    const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false)};
    document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);
  },[open]);
  return <div ref={ref} style={{position:"relative"}}>
    <button title={label} onClick={()=>setOpen(!open)} className="tb"><I n={label==="Text Color"?"palette":"hl"} s={13}/></button>
    {open&&<div className="nf-cpick-popup fade-in">
      {colors.map(c=><button key={c} className="nf-cpick-swatch" onClick={()=>{onChange(c);setOpen(false)}}
        style={{border:c==="transparent"?"1px dashed var(--border)":"1px solid var(--border-light)",background:c}}/>)}
    </div>}
  </div>;
}
function RenameInput({id,initialValue,onRename,onCancel}){
  const [val,setVal]=useState(initialValue||"");
  const ref=useRef(null);
  useEffect(()=>{
    if(ref.current){ref.current.focus();ref.current.select()}
  },[]);
  const commit=()=>onRename(id,val);
  return <input ref={ref} className="nf-rename" value={val}
    onChange={e=>setVal(e.target.value)}
    onBlur={commit}
    onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commit()}if(e.key==="Escape")onCancel()}}
    onClick={e=>e.stopPropagation()}
    onMouseDown={e=>e.stopPropagation()}/>;
}

/* ═══════════════════════════════════════════════════════════════
   PASSWORD DIALOG (reusable overlay)
   ═══════════════════════════════════════════════════════════════ */
function PasswordDialog({title,subtitle,onSubmit,onCancel,confirmLabel,error,showConfirm,showHint,children}){
  const [pw,setPw]=useState("");
  const [pw2,setPw2]=useState("");
  const [hint,setHint]=useState("");
  const [localErr,setLocalErr]=useState("");
  const ref=useRef(null);
  useEffect(()=>{ref.current?.focus()},[]);
  const submit=()=>{
    if(showConfirm&&pw!==pw2){setLocalErr("Passwords don't match");return}
    if(!pw.trim()){setLocalErr("Enter a password");return}
    setLocalErr("");onSubmit(pw,hint);
  };
  const stop=e=>e.stopPropagation();

  // Live password requirements (only shown when setting new password)
  const hasLen=pw.length>=10;
  const hasUpper=/[A-Z]/.test(pw);
  const hasLower=/[a-z]/.test(pw);
  const hasDigit=/[0-9]/.test(pw);
  const hasSymbol=/[^A-Za-z0-9]/.test(pw);
  const classes=[hasUpper,hasLower,hasDigit,hasSymbol].filter(Boolean).length;
  const allMet=hasLen&&classes>=3;

  const Req=({met,text})=><div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,
    color:met?"var(--success)":"var(--text-muted)",transition:"color .15s"}}>
    <span style={{fontSize:14}}>{met?"✓":"○"}</span>{text}
  </div>;

  return <div className="nf-overlay" style={THEMES.dark} onClick={stop} onMouseDown={stop} onKeyDown={stop} onKeyUp={stop} onKeyPress={stop}>
    <div className="nf-overlay-card">
      <div style={{marginBottom:16}}><I n="shield" s={32}/></div>
      <div className="nf-overlay-title">{title}</div>
      <div className="nf-overlay-sub">{subtitle}</div>
      {(error||localErr)&&<div className="nf-overlay-error">{error||localErr}</div>}
      <input ref={ref} className="nf-overlay-input" type="password" placeholder="Password"
        value={pw} onChange={e=>setPw(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter"&&(!showConfirm||pw2))submit()}}/>
      {showConfirm&&<>
        <input className="nf-overlay-input" type="password" placeholder="Confirm password"
          value={pw2} onChange={e=>setPw2(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter")submit()}}/>
        {/* Password requirements */}
        {pw.length>0&&<div style={{textAlign:"left",padding:"8px 12px",background:"var(--surface-alt)",
          borderRadius:8,marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:600,color:"var(--text-muted)",marginBottom:6,textTransform:"uppercase",letterSpacing:".5px"}}>Password Requirements</div>
          <Req met={hasLen} text="At least 10 characters"/>
          <Req met={classes>=3} text="3 of 4: uppercase, lowercase, number, symbol"/>
          <div style={{marginTop:6,display:"flex",gap:3}}>
            {[hasUpper,hasLower,hasDigit,hasSymbol].map((m,i)=>
              <div key={i} style={{flex:1,height:3,borderRadius:2,background:m?"var(--success)":"var(--border)",transition:"background .15s"}}/>
            )}
          </div>
          {pw2.length>0&&pw!==pw2&&<div style={{color:"var(--danger)",fontSize:11,marginTop:6}}>Passwords don't match</div>}
          {allMet&&pw===pw2&&pw2.length>0&&<div style={{color:"var(--success)",fontSize:11,marginTop:6}}>Ready to encrypt</div>}
        </div>}
        {showHint&&<input className="nf-overlay-input" type="text" placeholder="Password hint (optional, stored unencrypted)"
          value={hint} onChange={e=>setHint(e.target.value)}
          style={{marginBottom:12,fontSize:12,opacity:.8}}/>}
      </>}
      {children}
      <button className="nf-overlay-btn primary" onClick={submit}
        style={showConfirm&&(!allMet||pw!==pw2)?{opacity:.5,cursor:"not-allowed"}:{}}
        disabled={showConfirm&&(!allMet||pw!==pw2)}>
        {confirmLabel||"Unlock"}
      </button>
      {onCancel&&<button className="nf-overlay-btn secondary" onClick={onCancel}>Cancel</button>}
    </div>
  </div>;
}

/* ═══════════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════════ */
function NoteForge(){
  const savedPrefs=useRef(prefsStore.load());
  const [data,setData]=useState(null);
  const [dark,setDark]=useState(savedPrefs.current.dark!==undefined?savedPrefs.current.dark:true);
  const [navOpen,setNavOpen]=useState(savedPrefs.current.navOpen!==undefined?savedPrefs.current.navOpen:true);
  const [wrap,setWrap]=useState(savedPrefs.current.wrap!==undefined?savedPrefs.current.wrap:true);
  const [zoom,setZoom]=useState(savedPrefs.current.zoom||100);
  const [aNb,setANb]=useState(null);
  const [aSec,setASec]=useState(null);
  const [aPg,setAPg]=useState(null);
  const [expNb,setExpNb]=useState({});
  const [showFR,setShowFR]=useState(false);
  const [findT,setFindT]=useState("");
  const [replT,setReplT]=useState("");
  const [gSearch,setGSearch]=useState("");
  const [gResults,setGResults]=useState([]);
  const [gFocused,setGFocused]=useState(false);
  const [pgFilter,setPgFilter]=useState("");
  const [showTrash,setShowTrash]=useState(false);
  const [editId,setEditId]=useState(null);
  const [editVal,setEditVal]=useState("");
  const [ctx,setCtx]=useState(null);
  const [edCtx,setEdCtx]=useState(null);
  const [stats,setStats]=useState({w:0,c:0,l:0});
  const [saved,setSaved]=useState(true);

  // Encryption state
  const [appPhase,setAppPhase]=useState("loading"); // loading|needsPassword|ready
  const [encEnabled,setEncEnabled]=useState(false);
  const [masterHint,setMasterHint]=useState(null);
  const [pwDialog,setPwDialog]=useState(null); // null | {type,nbId,...}
  const [pwError,setPwError]=useState("");
  const [unlockedNbs,setUnlockedNbs]=useState(new Set()); // notebook IDs unlocked this session

  const edRef=useRef(null);
  const saveTimer=useRef(null);
  const statsTimer=useRef(null);
  const dataRef=useRef(null);
  dataRef.current=data;
  const aNbRef=useRef(null);aNbRef.current=aNb;
  const aSecRef=useRef(null);aSecRef.current=aSec;
  const nbPasswords=useRef(new Map());
  const [autoLockMin,setAutoLockMin]=useState(savedPrefs.current.autoLockMin||15);

  useEffect(()=>{prefsStore.save({dark,navOpen,wrap,zoom,autoLockMin})},[dark,navOpen,wrap,zoom,autoLockMin]);

  /* ── Lock / Auto-lock ────────────────────────────────────── */
  const idleTimer=useRef(null);

  const lockApp=useCallback(async()=>{
    if(saveTimer.current&&dataRef.current){
      clearTimeout(saveTimer.current);saveTimer.current=null;
      const sanitized=sanitizeForDiskSync(dataRef.current);
      await store.set(JSON.stringify(sanitized));
    }
    if(window.electronAPI?.lockApp)await window.electronAPI.lockApp();
    nbPasswords.current.clear();
    dataRef.current=null;setData(null);setANb(null);setASec(null);setAPg(null);
    setUnlockedNbs(new Set());
    if(encEnabled)setAppPhase("needsPassword");
  },[encEnabled]);

  // Reset idle timer on any user interaction
  useEffect(()=>{
    if(!encEnabled||appPhase!=="ready")return;
    const ms=autoLockMin*60*1000;
    const reset=()=>{
      if(idleTimer.current)clearTimeout(idleTimer.current);
      idleTimer.current=setTimeout(()=>lockApp(),ms);
    };
    reset();
    const events=["mousedown","keydown","scroll","touchstart"];
    events.forEach(e=>window.addEventListener(e,reset,{passive:true}));
    return()=>{
      if(idleTimer.current)clearTimeout(idleTimer.current);
      events.forEach(e=>window.removeEventListener(e,reset));
    };
  },[encEnabled,appPhase,lockApp,autoLockMin]);

  // Force-flush on window close (sync so it completes before shutdown)
  useEffect(()=>{
    const flush=()=>{
      if(saveTimer.current&&dataRef.current){
        clearTimeout(saveTimer.current);saveTimer.current=null;
        // CRITICAL: strip plaintext from locked notebooks before ANY write
        const sanitized=sanitizeForDiskSync(dataRef.current);
        const json=JSON.stringify(sanitized);
        if(window.electronAPI?.storageSetSync)window.electronAPI.storageSetSync(json);
        else try{localStorage.setItem("noteforge-data",json)}catch{}
      }
    };
    window.addEventListener("beforeunload",flush);
    return()=>window.removeEventListener("beforeunload",flush);
  },[]);

  /* ── Navigate ────────────────────────────────────────────── */
  const navigateTo=useCallback((nbId,secId,pgId)=>{
    setANb(nbId);setASec(secId);setAPg(pgId);
    if(nbId)setExpNb(p=>({...p,[nbId]:true}));
    setShowTrash(false);
  },[]);

  const loadIntoState=useCallback((d)=>{
    dataRef.current=d;
    setData(d);
    const nb=d.notebooks[0];
    if(nb){
      const isLocked=nb.locked&&!nb.sections?.length;
      if(!isLocked){
        const sec=nb.sections[0];
        if(sec){const pg=sec.pages.find(p=>!p.deleted);navigateTo(nb.id,sec.id,pg?.id||null)}
        else{setANb(nb.id);setExpNb({[nb.id]:true})}
      } else {setANb(nb.id);setExpNb({[nb.id]:true})}
    }
    setAppPhase("ready");
  },[navigateTo]);

  /* ── Load (encryption-aware) ─────────────────────────────── */
  useEffect(()=>{
    (async()=>{
      if(hasElectronCrypto()){
        const status=await window.electronAPI.checkEncryption();
        setEncEnabled(status.encrypted);
        if(status.hint)setMasterHint(status.hint);
        if(status.encrypted){setAppPhase("needsPassword");return}
      }
      // Not encrypted — load normally
      let d=null;
      try{const r=await store.get();if(r?.value)d=JSON.parse(r.value)}catch{}
      if(!d||!d.notebooks)d=structuredClone(DEFAULT_DATA);
      loadIntoState(d);
    })();
  },[]);

  /* ── Persist ─────────────────────────────────────────────── */
  const persist=useCallback(async(nd)=>{
    dataRef.current=nd; // Update ref IMMEDIATELY — don't wait for React re-render
    setData(nd);setSaved(false);
    if(saveTimer.current)clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(async()=>{
      let toSave=nd;
      // Step 1: Re-encrypt sections for any locked+unlocked-in-session notebooks
      // so edits are captured in the encrypted blob before we strip plaintext
      if(hasElectronCrypto()){
        const nbs=await Promise.all(nd.notebooks.map(async nb=>{
          if(nb.locked&&nb.sections?.length>0&&nbPasswords.current.has(nb.id)){
            const pw=nbPasswords.current.get(nb.id);
            const r=await window.electronAPI.encryptNotebookSections(JSON.stringify(nb.sections),pw);
            if(r.success)return{...nb,encSections:r.blob};
          }
          return nb;
        }));
        toSave={...nd,notebooks:nbs};
      }
      // Step 2: MANDATORY — strip ALL plaintext from locked notebooks before writing
      // This is the safety net. Even if step 1 failed or was skipped, plaintext never hits disk.
      toSave=sanitizeForDiskSync(toSave);
      await store.set(JSON.stringify(toSave));setSaved(true);
    },500);
  },[]);
  useEffect(()=>()=>{if(saveTimer.current)clearTimeout(saveTimer.current)},[]);

  /* ── Derived ─────────────────────────────────────────────── */
  const curPage=useMemo(()=>{
    if(!data||!aPg)return null;
    for(const nb of data.notebooks)for(const sec of nb.sections){
      const pg=sec.pages.find(p=>p.id===aPg&&!p.deleted);if(pg)return pg;
    }
    return null;
  },[data,aPg]);
  const curSection=useMemo(()=>{
    if(!data||!aSec)return null;
    for(const nb of data.notebooks){const sec=(nb.sections||[]).find(s=>s.id===aSec);if(sec)return sec}
    return null;
  },[data,aSec]);
  const curNotebook=useMemo(()=>data?.notebooks?.find(n=>n.id===aNb)||null,[data,aNb]);
  const sectionPages=useMemo(()=>{
    if(!curSection)return[];
    let pages=curSection.pages.filter(p=>!p.deleted);
    if(pgFilter.trim()){const q=pgFilter.toLowerCase();pages=pages.filter(p=>p.title.toLowerCase().includes(q))}
    return pages.sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)||b.modified-a.modified);
  },[curSection,pgFilter]);
  const breadcrumb=useMemo(()=>{
    if(!data||!aPg)return null;
    for(const nb of data.notebooks)for(const sec of nb.sections)
      if(sec.pages.find(p=>p.id===aPg))return{nb:nb.name,sec:sec.name,color:nb.color};
    return null;
  },[data,aPg]);
  const trashPages=useMemo(()=>{
    if(!data)return[];const r=[];
    for(const nb of data.notebooks)for(const sec of nb.sections||[])for(const pg of sec.pages)
      if(pg.deleted)r.push({...pg,nbName:nb.name,secName:sec.name});
    return r;
  },[data]);

  /* ── Editor content ──────────────────────────────────────── */
  const prevPgRef=useRef(null);
  useEffect(()=>{
    if(!edRef.current)return;
    if(curPage&&aPg!==prevPgRef.current){
      edRef.current.innerHTML=sanitizeHTML(curPage.content)||"<p><br></p>";
      prevPgRef.current=aPg;updStats();
    } else if(!curPage&&prevPgRef.current){
      edRef.current.innerHTML="";
      prevPgRef.current=null;
    }
  },[aPg,curPage]);
  const updStats=useCallback(()=>{
    if(statsTimer.current)clearTimeout(statsTimer.current);
    statsTimer.current=setTimeout(()=>{
      if(!edRef.current)return;const t=edRef.current.innerText||"";
      setStats({w:t.trim()?t.trim().split(/\s+/).length:0,c:t.length,l:t.split("\n").length});
    },120);
  },[]);
  const updatePage=useCallback((pageId,updater)=>{
    const d=dataRef.current;if(!d)return;
    const nd={...d,notebooks:d.notebooks.map(nb=>({...nb,sections:(nb.sections||[]).map(sec=>{
      const idx=sec.pages.findIndex(p=>p.id===pageId);
      if(idx===-1)return sec;
      const np=[...sec.pages];np[idx]={...np[idx],...updater(np[idx])};
      return{...sec,pages:np};
    })}))};
    persist(nd);
  },[persist]);
  const onInput=useCallback(()=>{
    if(!edRef.current||!dataRef.current||!aPg)return;
    updatePage(aPg,()=>({content:edRef.current.innerHTML,modified:Date.now()}));updStats();
  },[aPg,updatePage,updStats]);
  const exec=useCallback((cmd,val=null)=>{
    edRef.current?.focus();document.execCommand(cmd,false,val);setTimeout(()=>onInput(),10);
  },[onInput]);

  /* ── Paste ───────────────────────────────────────────────── */
  const onPaste=useCallback(e=>{
    const cd=e.clipboardData;if(!cd)return;
    // Check for images first
    for(const item of cd.items){
      if(item.type.startsWith("image/")){
        e.preventDefault();const file=item.getAsFile();
        if(file.size>512000){alert("Image too large (max 500KB).");return}
        const reader=new FileReader();
        reader.onload=ev=>exec("insertHTML",`<img src="${ev.target.result}">`);
        reader.readAsDataURL(file);return;
      }
    }
    // Always prevent default — never let the browser insert raw clipboard HTML
    e.preventDefault();
    // Prefer plain text (strips all formatting — clean paste like OneNote)
    const text=cd.getData("text/plain");
    if(text){document.execCommand("insertText",false,text);return}
    // Fallback: if only HTML is available (rare), sanitize it
    const html=cd.getData("text/html");
    if(html){const clean=sanitizeHTML(html);if(clean)document.execCommand("insertHTML",false,clean)}
  },[exec]);
  const onKeyDown=useCallback(e=>{
    if(e.key==="Tab"){
      const sel=window.getSelection();if(sel.anchorNode){
        let node=sel.anchorNode;
        while(node&&node!==edRef.current){
          if(node.nodeName==="PRE"){e.preventDefault();document.execCommand("insertText",false,"    ");return}
          node=node.parentNode;
        }
      }
    }
  },[]);

  /* ── Shortcuts ───────────────────────────────────────────── */
  useEffect(()=>{
    const h=e=>{
      const mod=e.ctrlKey||e.metaKey;
      if(mod&&e.key==="f"){e.preventDefault();setShowFR(p=>!p)}
      if(mod&&e.key==="h"){e.preventDefault();setShowFR(true)}
      if(mod&&e.key==="d"&&!e.shiftKey){e.preventDefault();if(aPg)duplicatePage(aPg)}
      if(mod&&e.key==="l"){e.preventDefault();if(encEnabled)lockApp()}
    };
    window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);
  },[aPg,encEnabled,lockApp]);

  /* ── Electron menu ───────────────────────────────────────── */
  useEffect(()=>{
    if(!window.electronAPI)return;
    const cleanup=window.electronAPI.onMenuAction(a=>{
      if(a==="toggle-sidebar")setNavOpen(p=>!p);
      if(a==="toggle-theme")setDark(p=>!p);
      if(a==="find-replace")setShowFR(p=>!p);
      if(a==="zoom-in")setZoom(z=>Math.min(200,z+10));
      if(a==="zoom-out")setZoom(z=>Math.max(50,z-10));
      if(a==="zoom-reset")setZoom(100);
      if(a==="toggle-wrap")setWrap(p=>!p);
      if(a==="export-html")doExportHTML();
      if(a==="export-text")doExportText();
      if(a==="print"){
        const nb=dataRef.current?.notebooks?.find(n=>n.id===aNbRef.current);
        const isLocked=nb?.locked||false;
        window.electronAPI.printWithWarning(isLocked);
      }
      if(a==="open-data-folder")window.electronAPI.openDataFolder();
      if(a==="encryption-settings")setPwDialog({type:"enc-settings"});
      if(a==="export-backup")window.electronAPI.exportBackup();
      if(a==="restore-backup")(async()=>{
        const r=await window.electronAPI.restoreBackup();
        if(r?.needsRestart){dataRef.current=null;setData(null);setEncEnabled(true);setAppPhase("needsPassword")}
      })();
      if(a==="lock-app"){if(encEnabled)lockApp()}
      if(a==="new-notebook")addNotebook();
      if(a==="new-page"){
        const d=dataRef.current;if(!d)return;
        const nb=d.notebooks.find(n=>n.id===aNbRef.current);
        if(nb&&nb.sections?.length){
          const sid=aSecRef.current&&(nb.sections||[]).find(s=>s.id===aSecRef.current)?aSecRef.current:nb.sections[0].id;
          addPage(nb.id,sid);
        }
      }
    });
    return cleanup;
  },[]);

  useEffect(()=>{const h=()=>{setCtx(null);setEdCtx(null)};window.addEventListener("click",h);return()=>window.removeEventListener("click",h)},[]);

  /* ═══════════════════════════════════════════════════════════
     CRUD
     ═══════════════════════════════════════════════════════════ */
  const addNotebook=()=>{
    const id=uid();const d=dataRef.current;
    persist({...d,notebooks:[...d.notebooks,{id,name:"New Notebook",color:NB_COLORS[d.notebooks.length%NB_COLORS.length],locked:false,encSections:null,sections:[]}]});
    setANb(id);setASec(null);setAPg(null);setExpNb(p=>({...p,[id]:true}));setEditId(id);setEditVal("New Notebook");
  };
  const addSection=(nbId)=>{
    const id=uid();const d=dataRef.current;
    persist({...d,notebooks:d.notebooks.map(n=>n.id!==nbId?n:{...n,sections:[...(n.sections||[]),{id,name:"New Section",color:n.color,pages:[]}]})});
    setANb(nbId);setASec(id);setAPg(null);setExpNb(p=>({...p,[nbId]:true}));setEditId(id);setEditVal("New Section");
  };
  const addPage=(nbId,secId)=>{
    const id=uid();const d=dataRef.current;
    persist({...d,notebooks:d.notebooks.map(nb=>nb.id!==nbId?nb:{...nb,sections:(nb.sections||[]).map(sec=>sec.id!==secId?sec:{
      ...sec,pages:[...sec.pages,{id,title:"New Page",content:"<p><br></p>",created:Date.now(),modified:Date.now(),pinned:false,deleted:false}]
    })})});
    navigateTo(nbId,secId,id);setEditId(id);setEditVal("New Page");
  };
  const duplicatePage=(pgId)=>{
    const d=dataRef.current;if(!d)return;
    for(const nb of d.notebooks)for(const sec of nb.sections||[]){
      const pg=sec.pages.find(p=>p.id===pgId);
      if(pg){
        const id=uid();
        persist({...d,notebooks:d.notebooks.map(n=>n.id!==nb.id?n:{...n,sections:(n.sections||[]).map(s=>s.id!==sec.id?s:{
          ...s,pages:[...s.pages,{...pg,id,title:pg.title+" (copy)",created:Date.now(),modified:Date.now(),pinned:false}]
        })})});
        navigateTo(nb.id,sec.id,id);return;
      }
    }
  };
  const rename=(itemId,name)=>{
    if(!name.trim())name="Untitled";const d=dataRef.current;
    persist({...d,notebooks:d.notebooks.map(nb=>{
      if(nb.id===itemId)return{...nb,name};
      return{...nb,sections:(nb.sections||[]).map(sec=>{
        if(sec.id===itemId)return{...sec,name};
        return{...sec,pages:sec.pages.map(pg=>pg.id===itemId?{...pg,title:name}:pg)};
      })};
    })});
    setEditId(null);
  };
  const autoSelectNextPage=(excludeId)=>{
    const d=dataRef.current;if(!d||!aSec)return;
    for(const nb of d.notebooks)for(const sec of nb.sections||[])
      if(sec.id===aSec){const pg=sec.pages.find(p=>!p.deleted&&p.id!==excludeId);setAPg(pg?.id||null);return}
    setAPg(null);
  };
  const softDelete=(pid)=>{updatePage(pid,()=>({deleted:true,modified:Date.now()}));if(aPg===pid)autoSelectNextPage(pid)};
  const restorePage=(pid)=>updatePage(pid,()=>({deleted:false}));
  const permDelete=(pid)=>{
    if(!confirm("Permanently delete this page?"))return;const d=dataRef.current;
    persist({...d,notebooks:d.notebooks.map(nb=>({...nb,sections:(nb.sections||[]).map(sec=>({...sec,pages:sec.pages.filter(p=>p.id!==pid)}))}))});
    if(aPg===pid)autoSelectNextPage(pid);
  };
  const togglePin=(pid)=>{
    for(const nb of dataRef.current.notebooks)for(const sec of nb.sections||[])
      if(sec.pages.find(p=>p.id===pid)){updatePage(pid,p=>({pinned:!p.pinned}));return}
  };
  const delSection=(sid)=>{
    const d=dataRef.current;let count=0;let parentNb=null;
    for(const nb of d.notebooks)for(const sec of nb.sections||[])if(sec.id===sid){count=sec.pages.length;parentNb=nb}
    if(!confirm(count>0?`Delete section and ${count} page${count>1?"s":""}?`:"Delete empty section?"))return;
    persist({...d,notebooks:d.notebooks.map(nb=>({...nb,sections:(nb.sections||[]).filter(s=>s.id!==sid)}))});
    if(aSec===sid){
      // Auto-select next section in same notebook
      const remaining=(parentNb?.sections||[]).filter(s=>s.id!==sid);
      if(remaining[0]){setASec(remaining[0].id);const pg=remaining[0].pages.find(p=>!p.deleted);setAPg(pg?.id||null)}
      else{setASec(null);setAPg(null)}
    }
  };
  const delNotebook=(nid)=>{
    const d=dataRef.current;const nb=d.notebooks.find(n=>n.id===nid);
    const pc=nb?(nb.sections||[]).reduce((a,s)=>a+s.pages.length,0):0;
    if(!confirm(pc>0?`Delete "${nb.name}" and all ${pc} pages?`:`Delete "${nb?.name}"?`))return;
    persist({...d,notebooks:d.notebooks.filter(n=>n.id!==nid)});
    nbPasswords.current.delete(nid);
    if(aNb===nid){setANb(null);setASec(null);setAPg(null)}
  };

  /* ═══ Notebook Lock/Unlock ═════════════════════════════════ */
  const lockNotebook=async(nbId,password)=>{
    if(!hasElectronCrypto())return{error:"Encryption not available"};
    const d=dataRef.current;const nb=d.notebooks.find(n=>n.id===nbId);
    if(!nb||!nb.sections?.length)return{error:"Nothing to lock"};
    const r=await window.electronAPI.encryptNotebookSections(JSON.stringify(nb.sections),password);
    if(!r.success)return{error:r.error};
    nbPasswords.current.set(nbId,password);
    // Keep sections in memory (user still has access this session).
    // sanitizeForDiskSync() strips them before every write — plaintext never reaches disk.
    const nd={...d,notebooks:d.notebooks.map(n=>n.id!==nbId?n:{...n,locked:true,encSections:r.blob})};
    persist(nd);
    setUnlockedNbs(p=>{const s=new Set(p);s.add(nbId);return s});
    return{};
  };

  const unlockNotebook=async(nbId,password)=>{
    if(!hasElectronCrypto())return{error:"Encryption not available"};
    const d=dataRef.current;const nb=d.notebooks.find(n=>n.id===nbId);
    if(!nb||!nb.locked||!nb.encSections)return{error:"Not locked"};
    const r=await window.electronAPI.decryptNotebookSections(nb.encSections,password);
    if(!r.success)return{error:r.error};
    try{
      const sections=JSON.parse(r.sections);
      nbPasswords.current.set(nbId,password);
      const nd={...d,notebooks:d.notebooks.map(n=>n.id!==nbId?n:{...n,sections})};
      dataRef.current=nd;
      setData(nd);
      setUnlockedNbs(p=>{const s=new Set(p);s.add(nbId);return s});
      // Auto-select first page
      if(sections[0]){
        setASec(sections[0].id);
        const pg=sections[0].pages?.find(p=>!p.deleted);
        setAPg(pg?.id||null);
      }else{setASec(null);setAPg(null)}
      return{};
    }catch{return{error:"Corrupted data"}}
  };

  const removeNotebookLock=(nbId)=>{
    const d=dataRef.current;
    const nd={...d,notebooks:d.notebooks.map(n=>n.id!==nbId?n:{...n,locked:false,encSections:null})};
    persist(nd);nbPasswords.current.delete(nbId);
    setUnlockedNbs(p=>{const s=new Set(p);s.delete(nbId);return s});
  };

  const isNbLocked=(nb)=>nb.locked&&(!nb.sections||nb.sections.length===0)&&!unlockedNbs.has(nb.id);

  /* ═══ Find & Replace ═══════════════════════════════════════ */
  const doFind=()=>{
    if(!findT||!edRef.current)return;
    const sel=window.getSelection();const r=document.createRange();
    r.selectNodeContents(edRef.current);sel.removeAllRanges();sel.addRange(r);
    if(window.find)window.find(findT,false,false,true);
  };
  const doReplace=()=>{
    if(!findT||!edRef.current)return;const sel=window.getSelection();
    if(sel.toString().toLowerCase()===findT.toLowerCase())document.execCommand("insertText",false,replT);
    doFind();
  };
  const doReplAll=()=>{
    if(!findT||!edRef.current)return;
    const walker=document.createTreeWalker(edRef.current,NodeFilter.SHOW_TEXT,null);
    const escaped=findT.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    for(const node of nodes){
      const re=new RegExp(escaped,"gi");
      if(re.test(node.textContent))node.textContent=node.textContent.replace(new RegExp(escaped,"gi"),replT);
    }
    onInput();
  };

  /* ═══ Global Search ════════════════════════════════════════ */
  const searchTimer=useRef(null);
  useEffect(()=>{
    if(searchTimer.current)clearTimeout(searchTimer.current);
    if(!gSearch.trim()||!data){setGResults([]);return}
    searchTimer.current=setTimeout(()=>{
      const q=gSearch.toLowerCase(),res=[];
      for(const nb of data.notebooks)for(const sec of nb.sections||[])for(const pg of sec.pages){
        if(pg.deleted)continue;
        const text=(pg.title+" "+(pg.content||"").replace(/<[^>]*>/g," ")).toLowerCase();
        if(text.includes(q))res.push({nbId:nb.id,secId:sec.id,page:pg,nbName:nb.name,secName:sec.name});
      }
      setGResults(res);
    },150);
  },[gSearch,data]);

  /* ═══ Insert Helpers ═══════════════════════════════════════ */
  const insertTable=()=>exec("insertHTML",
    '<table><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></table><p><br></p>');
  const insertCheck=()=>{const id=uid();exec("insertHTML",
    `<div class="nf-check"><input type="checkbox" id="${id}"><label for="${id}">To-do item</label></div>`)};
  const insertLink=()=>{
    const url=prompt("Enter URL:","https://");
    if(url){const sel=window.getSelection();const safe=escHtml(url);const text=escHtml(sel.toString()||url);
      exec("insertHTML",`<a href="${safe}" title="${safe}">${text}</a>`)}
  };

  /* ═══ Export ═══════════════════════════════════════════════ */
  const doExportHTML=async()=>{
    if(!curPage)return;
    if(window.electronAPI)await window.electronAPI.exportHTML(curPage.title,curPage.content);
    else{
      const doc=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escHtml(curPage.title)}</title><style>body{font-family:'DM Sans',sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.7;color:#1a1a1a}h1,h2,h3,h4{margin:.5em 0 .3em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}pre{background:#f5f5f5;padding:14px;border-radius:8px;overflow-x:auto}code{background:#f5f5f5;padding:2px 6px;border-radius:4px}blockquote{border-left:3px solid #6359d0;padding-left:14px;opacity:.85}</style></head><body>${curPage.content}</body></html>`;
      const b=new Blob([doc],{type:"text/html"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=curPage.title.replace(/[^a-z0-9]/gi,"_")+".html";a.click();URL.revokeObjectURL(a.href);
    }
  };
  const doExportText=async()=>{
    if(!curPage||!edRef.current)return;const text=edRef.current.innerText;
    if(window.electronAPI)await window.electronAPI.exportText(curPage.title,text);
    else{const b=new Blob([text],{type:"text/plain"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=curPage.title.replace(/[^a-z0-9]/gi,"_")+".txt";a.click();URL.revokeObjectURL(a.href)}
  };

  const findItem=(id)=>{
    if(!data)return null;
    for(const nb of data.notebooks){
      if(nb.id===id)return{type:"notebook",item:nb};
      for(const sec of nb.sections||[]){
        if(sec.id===id)return{type:"section",item:sec};
        for(const pg of sec.pages)if(pg.id===id)return{type:"page",item:pg};
      }
    }
    return null;
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  const tv=dark?THEMES.dark:THEMES.light;

  // Loading
  if(appPhase==="loading")return <div className="nf-overlay" style={tv}>
    <div style={{textAlign:"center"}}>
      <div style={{fontSize:28,fontWeight:700}}><span style={{color:"var(--accent)"}}>Note</span>Forge</div>
      <div style={{opacity:.4,marginTop:10,fontSize:13}}>Loading…</div>
    </div>
  </div>;

  // Master password prompt
  if(appPhase==="needsPassword")return <PasswordDialog
    title="Unlock NoteForge"
    subtitle={masterHint?`Enter your master password. Hint: ${masterHint}`:"Enter your master password to decrypt your notes."}
    confirmLabel="Unlock"
    error={pwError}
    onSubmit={async pw=>{
      setPwError("");
      const r=await window.electronAPI.unlockMaster(pw);
      if(r.error){setPwError(r.error);return}
      setEncEnabled(true);
      let d=null;try{d=JSON.parse(r.value)}catch{}
      if(!d||!d.notebooks)d=structuredClone(DEFAULT_DATA);
      loadIntoState(d);
    }}/>;

  if(!data)return null;

  return (
  <div className="nf-root" style={tv}>

  {/* ═══ PASSWORD DIALOGS ═════════════════════════════════════ */}
  {pwDialog?.type==="enc-settings"&&<div className="nf-overlay" style={tv} onClick={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()}>
    <div className="nf-overlay-card">
      <div style={{marginBottom:16}}><I n="shield" s={32}/></div>
      <div className="nf-overlay-title">Encryption Settings</div>
      <div className="nf-overlay-sub">AES-256-GCM encryption for all your notes.</div>
      <div style={{textAlign:"left",fontSize:13,marginBottom:16,padding:"10px 12px",background:"var(--surface-alt)",borderRadius:8}}>
        Status: <strong style={{color:encEnabled?"var(--success)":"var(--text-muted)"}}>{encEnabled?"Encrypted":"Not encrypted"}</strong>
      </div>
      {encEnabled&&<div style={{textAlign:"left",fontSize:13,marginBottom:16,padding:"10px 12px",background:"var(--surface-alt)",borderRadius:8,display:"flex",alignItems:"center",gap:8}}>
        <span>Auto-lock after</span>
        <select value={autoLockMin} onChange={e=>setAutoLockMin(Number(e.target.value))}
          style={{padding:"4px 8px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)",fontSize:13}}>
          <option value={5}>5 min</option>
          <option value={15}>15 min</option>
          <option value={30}>30 min</option>
          <option value={60}>60 min</option>
        </select>
        <span style={{fontSize:11,color:"var(--text-muted)"}}>of inactivity</span>
      </div>}
      {!encEnabled&&<button className="nf-overlay-btn primary" onClick={()=>setPwDialog({type:"enable-enc"})}>Enable Encryption</button>}
      {encEnabled&&<>
        <button className="nf-overlay-btn primary" onClick={()=>setPwDialog({type:"change-pw"})}>Change Password</button>
        <button className="nf-overlay-btn danger" onClick={()=>setPwDialog({type:"disable-enc"})}>Remove Encryption</button>
      </>}
      <button className="nf-overlay-btn secondary" onClick={()=>setPwDialog(null)}>Close</button>
    </div>
  </div>}

  {pwDialog?.type==="enable-enc"&&<PasswordDialog
    title="Enable Encryption" subtitle="Choose a master password. Don't forget it — there's no recovery."
    confirmLabel="Encrypt" showConfirm showHint error={pwError}
    onCancel={()=>{setPwDialog({type:"enc-settings"});setPwError("")}}
    onSubmit={async(pw,hint)=>{
      setPwError("");
      const r=await window.electronAPI.enableEncryption(pw,hint);
      if(r.error){setPwError(r.error);return}
      setEncEnabled(true);if(hint)setMasterHint(hint);
      setPwDialog({type:"enc-settings"});
    }}/>}

  {pwDialog?.type==="disable-enc"&&<PasswordDialog
    title="Remove Encryption" subtitle="Enter your current password to decrypt all data."
    confirmLabel="Remove Encryption" error={pwError}
    onCancel={()=>{setPwDialog({type:"enc-settings"});setPwError("")}}
    onSubmit={async pw=>{
      setPwError("");
      const r=await window.electronAPI.disableEncryption(pw);
      if(r.error){setPwError(r.error);return}
      setEncEnabled(false);setPwDialog({type:"enc-settings"});
    }}/>}

  {pwDialog?.type==="change-pw"&&<PasswordDialog
    title="Change Password — Step 1" subtitle="Enter your current password."
    confirmLabel="Next" error={pwError}
    onCancel={()=>{setPwDialog({type:"enc-settings"});setPwError("")}}
    onSubmit={async oldPw=>{
      setPwError("");
      setPwDialog({type:"change-pw-new",oldPw});
    }}/>}

  {pwDialog?.type==="change-pw-new"&&<PasswordDialog
    title="Change Password — Step 2" subtitle="Choose your new password."
    confirmLabel="Change Password" showConfirm error={pwError}
    onCancel={()=>{setPwDialog({type:"enc-settings"});setPwError("")}}
    onSubmit={async newPw=>{
      setPwError("");
      const r=await window.electronAPI.changeMasterPassword(pwDialog.oldPw,newPw);
      if(r.error){setPwError(r.error);return}
      setPwDialog({type:"enc-settings"});
    }}/>}

  {pwDialog?.type==="lock-nb"&&<PasswordDialog
    title="Lock Notebook" subtitle={`Set a password for "${pwDialog.name}".`}
    confirmLabel="Lock" showConfirm error={pwError}
    onCancel={()=>{setPwDialog(null);setPwError("")}}
    onSubmit={async pw=>{
      setPwError("");
      const r=await lockNotebook(pwDialog.nbId,pw);
      if(r.error){setPwError(r.error);return}
      setPwDialog(null);
    }}/>}

  {pwDialog?.type==="unlock-nb"&&<PasswordDialog
    title="Unlock Notebook" subtitle={`Enter password for "${pwDialog.name}".`}
    confirmLabel="Unlock" error={pwError}
    onCancel={()=>{setPwDialog(null);setPwError("")}}
    onSubmit={async pw=>{
      setPwError("");
      const r=await unlockNotebook(pwDialog.nbId,pw);
      if(r.error){setPwError(r.error);return}
      setPwDialog(null);
    }}/>}

  {/* ═══ HEADER ═══════════════════════════════════════════════ */}
  <div className="nf-header">
    <Btn icon="sidebar" label="Toggle Navigation" onClick={()=>setNavOpen(!navOpen)} active={navOpen}/>
    <div className="nf-logo"><span className="nf-logo-accent">Note</span>Forge</div>
    <div style={{flex:1,maxWidth:360,position:"relative",marginLeft:12}}>
      <div style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"var(--text-muted)",pointerEvents:"none"}}><I n="search" s={13}/></div>
      <input placeholder="Search all notes…" value={gSearch} onChange={e=>setGSearch(e.target.value)}
        onFocus={()=>setGFocused(true)} onBlur={()=>setTimeout(()=>setGFocused(false),250)}
        style={{width:"100%",height:30,paddingLeft:30,paddingRight:10,border:"1px solid var(--border)",borderRadius:8,background:"var(--bg)",color:"var(--text)",fontSize:12.5,outline:"none"}}/>
      {gResults.length>0&&gFocused&&<div className="nf-gsearch-dropdown fade-in">
        {gResults.slice(0,20).map(r=>{
          // Highlight matching text
          const hl=(text)=>{
            if(!gSearch.trim())return text;
            const idx=text.toLowerCase().indexOf(gSearch.toLowerCase());
            if(idx===-1)return text;
            return <>{text.slice(0,idx)}<mark style={{background:"var(--accent-bg)",color:"var(--accent)",borderRadius:2,padding:"0 1px"}}>{text.slice(idx,idx+gSearch.length)}</mark>{text.slice(idx+gSearch.length)}</>;
          };
          const preview=snippet(r.page.content);
          return <div key={r.page.id} className="nf-gsearch-item"
          onMouseDown={e=>{e.preventDefault();navigateTo(r.nbId,r.secId,r.page.id);setGSearch("")}}>
          <div style={{fontSize:13,fontWeight:600}}>{hl(r.page.title)}</div>
          {preview&&<div style={{fontSize:11,color:"var(--text-muted)",marginTop:1}}>{hl(preview)}</div>}
          <div style={{fontSize:10,color:"var(--text-muted)",opacity:.6}}>{r.nbName} › {r.secName}</div>
        </div>})}
      </div>}
    </div>
    <div style={{flex:1}}/>
    {encEnabled&&<Btn icon="lock" label="Lock App (Ctrl+L)" onClick={lockApp} s={13}/>}
    <Btn icon="dl" label="Export HTML" onClick={doExportHTML}/>
    <Btn icon="print" label="Print" onClick={()=>{
      if(window.electronAPI){const nb=data?.notebooks?.find(n=>n.id===aNb);window.electronAPI.printWithWarning(nb?.locked||false)}
      else window.print()
    }}/>
    <Btn icon={dark?"sun":"moon"} label="Toggle Theme" onClick={()=>setDark(!dark)}/>
  </div>

  {/* ═══ 3-PANEL BODY ═════════════════════════════════════════ */}
  <div className="nf-body">

  {/* ── Panel 1: Notebooks & Sections ──────────────────────── */}
  <div className={`nf-nav${navOpen?"":" collapsed"}`}>
    <div className="nf-nav-scroll">
      {data.notebooks.map(nb=>{
        const locked=isNbLocked(nb);
        return <div key={nb.id}>
        <div className={`nf-nb${aNb===nb.id?" active":""}`}
          onClick={()=>{
            if(editId===nb.id)return;
            if(locked){setPwDialog({type:"unlock-nb",nbId:nb.id,name:nb.name});return}
            setANb(nb.id);setExpNb(p=>({...p,[nb.id]:!p[nb.id]}));
            if(!expNb[nb.id]){
              const sec=nb.sections?.[0];
              if(sec){setASec(sec.id);setPgFilter("");
                const pg=sec.pages.find(p=>!p.deleted);setAPg(pg?.id||null)
              }else{setASec(null);setAPg(null)}
            }
            setShowTrash(false)}}
          onContextMenu={e=>{e.preventDefault();setCtx({x:e.clientX,y:e.clientY,id:nb.id})}}>
          <div className={`nf-nb-chevron${expNb[nb.id]?" open":""}`}><I n="chev" s={11}/></div>
          <div className="nf-nb-color" style={{background:nb.color}}/>
          {editId===nb.id?<RenameInput id={nb.id} initialValue={editVal} onRename={rename} onCancel={()=>setEditId(null)}/>
            :<span className="nf-nb-name">{nb.name}</span>}
          {locked&&<span className="nf-lock-badge"><I n="lock" s={12}/></span>}
          {nb.locked&&!locked&&<span className="nf-lock-badge" style={{opacity:.3}}><I n="unlock" s={12}/></span>}
        </div>
        {expNb[nb.id]&&!locked&&<>
          {(nb.sections||[]).map(sec=><div key={sec.id}
            className={`nf-sec${aSec===sec.id?" active":""}`}
            onClick={()=>{if(editId===sec.id)return;setANb(nb.id);setASec(sec.id);setShowTrash(false);setPgFilter("");
              const pg=sec.pages.find(p=>!p.deleted);setAPg(pg?.id||null)}}
            onContextMenu={e=>{e.preventDefault();setCtx({x:e.clientX,y:e.clientY,id:sec.id})}}>
            <div className="nf-sec-bar" style={{background:sec.color||nb.color}}/>
            {editId===sec.id?<RenameInput id={sec.id} initialValue={editVal} onRename={rename} onCancel={()=>setEditId(null)}/>
              :<span className="nf-sec-name">{sec.name}</span>}
            <span style={{fontSize:10,color:"var(--text-muted)",flexShrink:0}}>{sec.pages.filter(p=>!p.deleted).length}</span>
          </div>)}
          <div className="nf-add-btn" style={{marginLeft:10}} onClick={()=>addSection(nb.id)}>
            <I n="plus" s={11}/><span>Add Section</span>
          </div>
        </>}
      </div>})}
    </div>
    <div className="nf-nav-footer">
      <div className="nf-add-btn" onClick={addNotebook}><I n="plus" s={13}/><span>New Notebook</span></div>
      <div className={`nf-add-btn${showTrash?" active":""}`} style={showTrash?{color:"var(--accent)"}:{}} onClick={()=>setShowTrash(!showTrash)}>
        <I n="trash" s={13}/><span>Trash{trashPages.length>0?` (${trashPages.length})`:""}</span>
      </div>
    </div>
  </div>

  {/* ── Panel 2: Page List ─────────────────────────────────── */}
  {aSec&&!showTrash&&<div className="nf-pages">
    <div className="nf-pages-header">
      <div className="nf-pages-title">
        <div style={{width:4,height:16,borderRadius:2,background:curNotebook?.color||"var(--accent)",flexShrink:0}}/>
        <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{curSection?.name||"Section"}</span>
      </div>
      <div style={{position:"relative"}}>
        <div style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:"var(--text-muted)",pointerEvents:"none"}}><I n="search" s={12}/></div>
        <input className="nf-pages-search" placeholder="Filter pages…" value={pgFilter} onChange={e=>setPgFilter(e.target.value)}/>
      </div>
    </div>
    <div className="nf-pages-scroll">
      {sectionPages.length===0
        ?<div style={{padding:"24px 12px",textAlign:"center",color:"var(--text-muted)",fontSize:12}}>{pgFilter?"No matching pages":"No pages yet"}</div>
        :sectionPages.map(pg=><div key={pg.id} className={`nf-pg${aPg===pg.id?" active":""}`}
          onClick={()=>{if(editId===pg.id)return;navigateTo(aNb,aSec,pg.id)}}
          onContextMenu={e=>{e.preventDefault();setCtx({x:e.clientX,y:e.clientY,id:pg.id})}}>
          <div className="nf-pg-title">
            {pg.pinned&&<span className="nf-pg-pin">📌 </span>}
            {editId===pg.id?<RenameInput id={pg.id} initialValue={editVal} onRename={rename} onCancel={()=>setEditId(null)}/>:pg.title}
          </div>
          <div className="nf-pg-preview">{snippet(pg.content)}</div>
          <div className="nf-pg-meta">{new Date(pg.modified).toLocaleDateString()}</div>
        </div>)}
    </div>
    <div className="nf-pages-footer">
      <div className="nf-add-btn" onClick={()=>addPage(aNb,aSec)}><I n="plus" s={13}/><span>New Page</span></div>
    </div>
  </div>}

  {/* ── Panel 3: Editor ────────────────────────────────────── */}
  <div className="nf-editor-wrap">
    {showTrash?<div style={{flex:1,overflowY:"auto",padding:28}}>
      <h2 style={{fontSize:20,fontWeight:700,marginBottom:16,display:"flex",alignItems:"center",gap:8}}><I n="trash" s={20}/> Trash</h2>
      {!trashPages.length?<div style={{color:"var(--text-muted)",padding:48,textAlign:"center"}}>Trash is empty</div>
        :trashPages.map(p=><div key={p.id} className="nf-trash-item">
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:600}}>{p.title}</div>
            <div style={{fontSize:11,color:"var(--text-muted)"}}>{p.nbName} › {p.secName} · {new Date(p.modified).toLocaleDateString()}</div>
          </div>
          <button className="nf-trash-btn" onClick={()=>restorePage(p.id)} style={{marginRight:8,border:"1px solid var(--border)",background:"var(--accent-bg)",color:"var(--accent)",fontWeight:600}}>Restore</button>
          <button className="nf-trash-btn" onClick={()=>permDelete(p.id)} style={{border:"1px solid var(--danger)",background:"transparent",color:"var(--danger)"}}>Delete Forever</button>
        </div>)}
    </div>
    :curPage?<>
      <div className="nf-toolbar">
        <Btn icon="undo" label="Undo" onClick={()=>exec("undo")} s={13}/>
        <Btn icon="redo" label="Redo" onClick={()=>exec("redo")} s={13}/><div className="tb-sep"/>
        <Sel value="div" opts={HEADINGS.map(h=>({l:h.l,v:h.v}))} onChange={v=>exec("formatBlock",v)} w={60}/>
        <Sel value="3" opts={FONT_SIZES.map(f=>({l:f.l+"px",v:f.v}))} onChange={v=>exec("fontSize",v)} w={58}/><div className="tb-sep"/>
        <Btn icon="bold" label="Bold" onClick={()=>exec("bold")} s={13}/>
        <Btn icon="italic" label="Italic" onClick={()=>exec("italic")} s={13}/>
        <Btn icon="underline" label="Underline" onClick={()=>exec("underline")} s={13}/>
        <Btn icon="strike" label="Strikethrough" onClick={()=>exec("strikeThrough")} s={13}/>
        <Btn icon="eraser" label="Clear Formatting" onClick={()=>exec("removeFormat")} s={13}/><div className="tb-sep"/>
        <CPick colors={TXT_COLORS} onChange={c=>exec("foreColor",c)} label="Text Color"/>
        <CPick colors={HL_COLORS} onChange={c=>exec("hiliteColor",c)} label="Highlight"/><div className="tb-sep"/>
        <Btn icon="ul" label="Bullet List" onClick={()=>exec("insertUnorderedList")} s={13}/>
        <Btn icon="ol" label="Numbered List" onClick={()=>exec("insertOrderedList")} s={13}/>
        <Btn icon="check" label="Checklist" onClick={insertCheck} s={13}/>
        <Btn icon="indent" label="Indent" onClick={()=>exec("indent")} s={13}/>
        <Btn icon="outdent" label="Outdent" onClick={()=>exec("outdent")} s={13}/><div className="tb-sep"/>
        <Btn icon="table" label="Table" onClick={insertTable} s={13}/>
        <Btn icon="link" label="Link" onClick={insertLink} s={13}/>
        <Btn icon="quote" label="Blockquote" onClick={()=>exec("formatBlock","blockquote")} s={13}/>
        <Btn icon="code" label="Code Block" onClick={()=>exec("formatBlock","pre")} s={13}/>
        <Btn icon="hr" label="Horizontal Rule" onClick={()=>exec("insertHorizontalRule")} s={13}/><div className="tb-sep"/>
        <Btn icon="search" label="Find & Replace" onClick={()=>setShowFR(!showFR)} active={showFR} s={13}/>
        <Btn icon="wrap" label="Word Wrap" onClick={()=>setWrap(!wrap)} active={wrap} s={13}/>
        <Btn icon="zin" label="Zoom In" onClick={()=>setZoom(z=>Math.min(200,z+10))} s={13}/>
        <span style={{fontSize:10,color:"var(--text-muted)",minWidth:28,textAlign:"center",userSelect:"none"}}>{zoom}%</span>
        <Btn icon="zout" label="Zoom Out" onClick={()=>setZoom(z=>Math.max(50,z-10))} s={13}/>
      </div>
      {showFR&&<div className="nf-find-bar fade-in">
        <input className="nf-find-input" style={{width:160}} placeholder="Find…" value={findT} onChange={e=>setFindT(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doFind()}/>
        <input className="nf-find-input" style={{width:160}} placeholder="Replace…" value={replT} onChange={e=>setReplT(e.target.value)}/>
        <button className="nf-find-btn" onClick={doFind} style={{border:"1px solid var(--accent)",background:"var(--accent-bg)",color:"var(--accent)",fontWeight:600}}>Find</button>
        <button className="nf-find-btn" onClick={doReplace} style={{border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)"}}>Replace</button>
        <button className="nf-find-btn" onClick={doReplAll} style={{border:"1px solid var(--border)",background:"var(--bg)",color:"var(--text)"}}>All</button>
        <Btn icon="x" label="Close" onClick={()=>setShowFR(false)} s={13}/>
      </div>}
      <div className="nf-title-area">
        {breadcrumb&&<div className="nf-breadcrumb"><div className="nf-breadcrumb-dot" style={{background:breadcrumb.color}}/>{breadcrumb.nb} <span style={{opacity:.5}}>›</span> {breadcrumb.sec}</div>}
        <input className="nf-title-input" value={curPage.title} onChange={e=>updatePage(aPg,()=>({title:e.target.value,modified:Date.now()}))}/>
        <div className="nf-timestamps"><span>Created {new Date(curPage.created).toLocaleString()}</span><span>Modified {new Date(curPage.modified).toLocaleString()}</span></div>
      </div>
      <div ref={edRef} className="nf-editor" contentEditable suppressContentEditableWarning
        onInput={onInput} onPaste={onPaste} onKeyDown={onKeyDown}
        onContextMenu={e=>{e.preventDefault();setEdCtx({x:e.clientX,y:e.clientY});setCtx(null)}}
        style={{fontSize:`${14*zoom/100}px`,whiteSpace:wrap?"pre-wrap":"pre",overflowX:wrap?"hidden":"auto",wordWrap:wrap?"break-word":"normal"}}/>
    </>
    :<div className="nf-empty">
      <div style={{opacity:.15}}><I n="book" s={56}/></div>
      <div style={{fontSize:17,fontWeight:600,opacity:.5}}>{aSec?"Select or create a page":"Select a section"}</div>
    </div>}
    {curPage&&!showTrash&&<div className="nf-status">
      <span>{stats.w} words</span><span>{stats.c} chars</span><span>{stats.l} lines</span>
      <div style={{flex:1}}/>
      {encEnabled&&<span className="nf-enc-badge"><I n="lock" s={10}/> Encrypted</span>}
      <span>{zoom}%</span><span>Wrap {wrap?"on":"off"}</span>
      <span style={{color:saved?"var(--success)":"var(--warning)",display:"flex",alignItems:"center",gap:3}}>
        <span className="nf-status-dot" style={{background:"currentColor"}}/>{saved?"Saved":"Saving…"}
      </span>
    </div>}
  </div>
  </div>

  {/* ═══ SIDEBAR CONTEXT MENU ═════════════════════════════════ */}
  {ctx&&(()=>{
    const found=findItem(ctx.id);if(!found)return null;
    const mx=Math.min(ctx.x,window.innerWidth-200);
    const my=Math.min(ctx.y,window.innerHeight-200);
    return <div className="nf-ctx fade-in" style={{left:mx,top:my}}>
      <div className="nf-ctx-item" onClick={()=>{setEditId(ctx.id);setEditVal(found.item.name||found.item.title||"");setCtx(null)}}><I n="edit" s={13}/> Rename</div>
      {found.type==="page"&&<>
        <div className="nf-ctx-item" onClick={()=>{duplicatePage(ctx.id);setCtx(null)}}><I n="copy" s={13}/> Duplicate</div>
        <div className="nf-ctx-item" onClick={()=>{togglePin(ctx.id);setCtx(null)}}><I n="pin" s={13}/> {found.item.pinned?"Unpin":"Pin to Top"}</div>
        <div className="nf-ctx-sep"/><div className="nf-ctx-item danger" onClick={()=>{softDelete(ctx.id);setCtx(null)}}><I n="trash" s={13}/> Delete</div>
      </>}
      {found.type==="section"&&<><div className="nf-ctx-sep"/><div className="nf-ctx-item danger" onClick={()=>{delSection(ctx.id);setCtx(null)}}><I n="trash" s={13}/> Delete Section</div></>}
      {found.type==="notebook"&&<>
        {hasElectronCrypto()&&!found.item.locked&&<>
          <div className="nf-ctx-sep"/>
          <div className="nf-ctx-item" onClick={()=>{setPwDialog({type:"lock-nb",nbId:ctx.id,name:found.item.name});setCtx(null)}}><I n="lock" s={13}/> Set Password</div>
        </>}
        {hasElectronCrypto()&&found.item.locked&&<>
          <div className="nf-ctx-sep"/>
          <div className="nf-ctx-item" onClick={()=>{removeNotebookLock(ctx.id);setCtx(null)}}><I n="unlock" s={13}/> Remove Password</div>
        </>}
        <div className="nf-ctx-sep"/><div className="nf-ctx-item danger" onClick={()=>{delNotebook(ctx.id);setCtx(null)}}><I n="trash" s={13}/> Delete Notebook</div>
      </>}
    </div>;
  })()}

  {/* ═══ EDITOR CONTEXT MENU ══════════════════════════════════ */}
  {edCtx&&(()=>{
    const mx=Math.min(edCtx.x,window.innerWidth-200);
    const my=Math.min(edCtx.y,window.innerHeight-320);
    const hasSel=window.getSelection()?.toString()?.length>0;
    const doCmd=(cmd)=>{exec(cmd);setEdCtx(null)};
    return <div className="nf-ctx fade-in" style={{left:mx,top:my}}>
      <div className={`nf-ctx-item${!hasSel?" disabled":""}`} onClick={()=>{if(hasSel){document.execCommand("cut");setTimeout(()=>onInput(),10)}setEdCtx(null)}}><I n="scissors" s={13}/> Cut <span style={{marginLeft:"auto",fontSize:10,color:"var(--text-muted)"}}>Ctrl+X</span></div>
      <div className={`nf-ctx-item${!hasSel?" disabled":""}`} onClick={()=>{if(hasSel)document.execCommand("copy");setEdCtx(null)}}><I n="copy" s={13}/> Copy <span style={{marginLeft:"auto",fontSize:10,color:"var(--text-muted)"}}>Ctrl+C</span></div>
      <div className="nf-ctx-item" onClick={async()=>{try{const t=await navigator.clipboard.readText();if(t){edRef.current?.focus();document.execCommand("insertText",false,t);setTimeout(()=>onInput(),10)}}catch{}setEdCtx(null)}}><I n="clipboard" s={13}/> Paste <span style={{marginLeft:"auto",fontSize:10,color:"var(--text-muted)"}}>Ctrl+V</span></div>
      <div className="nf-ctx-item" onClick={()=>{document.execCommand("selectAll");setEdCtx(null)}}><I n="check" s={13}/> Select All</div>
      <div className="nf-ctx-sep"/>
      <div className={`nf-ctx-item${!hasSel?" disabled":""}`} onClick={()=>doCmd("bold")}><I n="bold" s={13}/> Bold</div>
      <div className={`nf-ctx-item${!hasSel?" disabled":""}`} onClick={()=>doCmd("italic")}><I n="italic" s={13}/> Italic</div>
      <div className={`nf-ctx-item${!hasSel?" disabled":""}`} onClick={()=>doCmd("underline")}><I n="underline" s={13}/> Underline</div>
      <div className="nf-ctx-sep"/>
      <div className="nf-ctx-item" onClick={()=>{insertLink();setEdCtx(null)}}><I n="link" s={13}/> Insert Link</div>
      <div className="nf-ctx-item" onClick={()=>{insertTable();setEdCtx(null)}}><I n="table" s={13}/> Insert Table</div>
      <div className="nf-ctx-sep"/>
      <div className={`nf-ctx-item${!hasSel?" disabled":""}`} onClick={()=>doCmd("removeFormat")}><I n="eraser" s={13}/> Clear Formatting</div>
    </div>;
  })()}

  </div>);
}

ReactDOM.createRoot(document.getElementById("root")).render(<NoteForge/>);
