const bindings=new Map();
const nativeOpen=menu=>!!menu&&typeof menu.showPopover==='function'&&menu.matches(':popover-open');
export function close(id){
    const entry=bindings.get(id),menu=document.getElementById(id);
    if(nativeOpen(menu))menu.hidePopover();
    menu?.classList.remove('is-open');entry?.anchor?.setAttribute('aria-expanded','false');
}
export function show(id,anchorId){
    const menu=document.getElementById(id),anchor=document.getElementById(anchorId);if(!menu||!anchor)return;
    if(nativeOpen(menu)||menu.classList.contains('is-open')){close(id);return;}
    for(const other of bindings.keys())close(other);
    dispose(id);
    const outside=event=>{if(!menu.contains(event.target)&&!anchor.contains(event.target))close(id);};
    const key=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(id);anchor.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();const items=[...menu.querySelectorAll('button:not(:disabled)')],at=items.indexOf(document.activeElement);
        const index=event.key==='Home'?0:event.key==='End'?items.length-1:(at+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[index]?.focus();
    }};
    const toggle=()=>anchor.setAttribute('aria-expanded',nativeOpen(menu)?'true':'false');
    bindings.set(id,{anchor,outside,key,toggle});
    if(menu.showPopover)menu.showPopover();else menu.classList.add('is-open');
    const rect=anchor.getBoundingClientRect(),width=Math.min(264,innerWidth-24);
    menu.style.width=width+'px';menu.style.left=Math.max(12,Math.min(innerWidth-width-12,rect.right-width))+'px';
    menu.style.top=Math.min(rect.bottom+10,Math.max(12,innerHeight-menu.offsetHeight-12))+'px';anchor.setAttribute('aria-expanded','true');
    document.addEventListener('pointerdown',outside,true);menu.addEventListener('keydown',key);menu.addEventListener('toggle',toggle);
    menu.querySelector('button.selected,button:not(:disabled)')?.focus({preventScroll:true});
}
export function dispose(id){
    const entry=bindings.get(id);if(!entry)return;
    document.removeEventListener('pointerdown',entry.outside,true);
    const menu=document.getElementById(id);menu?.removeEventListener('keydown',entry.key);menu?.removeEventListener('toggle',entry.toggle);bindings.delete(id);
}

// Component disposal occurs after a Server circuit may already be disconnected.
// Release listeners from the browser when menu DOM disappears, without .NET interop.
const lifecycle=new MutationObserver(()=>{
    for(const id of [...bindings.keys()])if(!document.getElementById(id)||!bindings.get(id)?.anchor?.isConnected)dispose(id);
});
lifecycle.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('pagehide',()=>{for(const id of [...bindings.keys()])dispose(id);});
