import {
  GX_FIT_SCRIPT,
  GX_FIT_STYLE,
  GX_KIT_SCRIPT,
  GX_KIT_STYLE,
  GX_PAGE_BOOTSTRAP,
  GX_THEME_STYLE,
} from "./ghostexKit.generated.ts";

/** What the parent frame and a Live page say to each other through `postMessage`. */
export const PM_PAGE_SUBMIT = "pm.page.submit";
export const PM_PAGE_RESULT = "pm.page.result";

export interface PmPageState {
  readonly answered: boolean;
  readonly answers: unknown;
  readonly answeredAt: string | null;
  /** A page without questions waits until the reader has looked at it. */
  readonly awaitsSeen: boolean;
}

// No outside requests: the page travels over the WebSocket to remote clients, so it must be
// self-contained, and an opaque-origin frame has nothing of ours to reach anyway.
const PAGE_POLICY =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

/**
 * Stands in for Ghostex's page API (theme.rs `PAGE_API`), which the kit calls as
 * `window.ghostex`: answers go to the parent frame by `postMessage` instead of an HTTP route,
 * and drafts live for as long as the frame is open.
 */
const PAGE_API = `<script>(function(){var st=null,draft={},pending={},next=1;
function note(){if(!st||!st.answered||!document.body||document.getElementById("gx-answered"))return;var b=document.createElement("div");b.id="gx-answered";b.setAttribute("role","status");b.setAttribute("style","margin:0 0 12px;padding:8px 12px;border-radius:8px;font:500 12.5px/1.4 var(--font-sans);color:var(--success);background:color-mix(in srgb,var(--success) 12%,transparent);border:1px solid color-mix(in srgb,var(--success) 32%,transparent)");var when="";try{when=st.answeredAt?" on "+new Date(st.answeredAt).toLocaleString():"";}catch(e){}b.textContent=st.answers&&st.answers.seen===true?"Marked as seen"+when+". The project manager was told.":"Answered"+when+". The project manager has your answers.";var slot=document.querySelector("[data-gx-answered]"),kit=document.querySelector("gx-questions");if(slot)slot.appendChild(b);else if(kit){b.style.margin="0";kit.insertBefore(b,kit.firstChild);}else document.body.insertBefore(b,document.body.firstChild);}
addEventListener("message",function(e){var d=e.data;if(e.source!==parent||!d||d.type!=="${PM_PAGE_RESULT}")return;var p=pending[d.requestId];if(!p)return;delete pending[d.requestId];if(d.ok)p.resolve(d);else p.reject(new Error(d.error||"Your answers were not sent."));});
function save(part,value){if(st&&st.answered)return;if(value==null)delete draft[part];else draft[part]=value;}
window.ghostex={get exported(){return null;},get answered(){return!!(st&&st.answered);},get awaitsSeen(){return!!(st&&st.awaitsSeen);},get answers(){return st&&st.answered?st.answers:null;},
get draft(){return draft.page===undefined?null:draft.page;},saveDraft:function(value){save("page",value===undefined?null:value);},
submit:function(answers){return new Promise(function(resolve,reject){var id=next++;pending[id]={resolve:function(j){st={answered:true,answers:answers,answeredAt:new Date().toISOString(),awaitsSeen:false};draft={};note();resolve(j);},reject:reject};parent.postMessage({type:"${PM_PAGE_SUBMIT}",requestId:id,answers:answers===undefined?null:answers},"*");});},
__draft:function(part){return draft[part]===undefined?null:draft[part];},__saveDraft:save,__pending:function(){return null;},__flush:function(){return true;},
__state:function(s){st=s;var ready=function(){note();};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ready);else ready();}};})();</script>`;

/** Where a client may put a script that sets `data-gx-theme` before the kit reads it. */
export const PM_PAGE_THEME_SLOT = "<!--pm-page-theme-->";

const escapeScriptJson = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028");

/**
 * A stored page with Ghostex's page kit in front: the content policy, theme, page API bridge and
 * question kit, at the very start of `<head>` so nothing in the page runs or styles itself first.
 */
export function preparePmPage(html: string, state: PmPageState): string {
  const block = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">`,
    PM_PAGE_THEME_SLOT,
    GX_THEME_STYLE,
    GX_PAGE_BOOTSTRAP,
    PAGE_API,
    `<script>window.ghostex.__state(${escapeScriptJson(state)});</script>`,
    GX_KIT_STYLE,
    GX_KIT_SCRIPT,
    GX_FIT_STYLE,
    GX_FIT_SCRIPT,
  ].join("");
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head)
    return `${html.slice(0, head.index + head[0].length)}${block}${html.slice(head.index + head[0].length)}`;
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root)
    return `${html.slice(0, root.index + root[0].length)}<head>${block}</head>${html.slice(root.index + root[0].length)}`;
  return `<!doctype html><html><head>${block}</head><body>${html}</body></html>`;
}

/** Sets the page's theme before the kit reads it (a `srcdoc` frame has no URL fragment to carry it). */
export const withPmPageTheme = (html: string, theme: "light" | "dark") =>
  html.replace(
    PM_PAGE_THEME_SLOT,
    `<script>document.documentElement.setAttribute("data-gx-theme","${theme}");</script>`,
  );

/** True when the answers are the "Mark as seen" kind a page without questions sends. */
export const isPmPageSeen = (answers: unknown): answers is { seen: true; reply?: string } =>
  typeof answers === "object" && answers !== null && (answers as { seen?: unknown }).seen === true;
