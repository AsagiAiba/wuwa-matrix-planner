// Both planner workflows use the same top-level modal. Restore focus to the caller on release.
export function showCalculationOverlay() {
  const doc = window.parent.document;
  const dialog = doc.createElement('dialog');
  dialog.id = 'calculation-overlay';
  dialog.setAttribute('aria-label','计算中');
  const status = doc.createElement('div'), spinner = doc.createElement('span');
  status.className='calculation-status';status.tabIndex=-1;status.setAttribute('role','status');
  spinner.className='calc-spinner';spinner.setAttribute('aria-hidden','true');
  status.append(spinner,'计算中');dialog.append(status);
  const previous=doc.activeElement, controls=new AbortController();
  const block=event=>{event.preventDefault();event.stopImmediatePropagation();};
  for(const type of ['keydown','dragover','drop','wheel','touchmove']){
    doc.defaultView.addEventListener(type,block,{capture:true,passive:false,signal:controls.signal});
  }
  dialog.addEventListener('cancel',block);
  function close(){
    if(controls.signal.aborted)return;
    controls.abort();dialog.close();dialog.remove();
    if(previous?.isConnected)previous.focus({preventScroll:true});
  }
  try{
    doc.body.append(dialog);dialog.showModal();status.focus({preventScroll:true});
    window.addEventListener('pagehide',close,{once:true,signal:controls.signal});
    return close;
  }catch(error){close();throw error;}
}
