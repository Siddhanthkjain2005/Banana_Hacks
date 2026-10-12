export function initNeural({state,$,modal,toast,compute,updateMetrics,replan}) {
  let worker,sequence=0;
  function promptInside(s) {
    let x=0,y=0,count=0;
    for(let p=0;p<s.mask.length;p++)if(s.mask[p]){x+=p%s.bbox.width;y+=Math.floor(p/s.bbox.width);count++;}
    x/=count;y/=count;let best=0,distance=Infinity;
    for(let p=0;p<s.mask.length;p++)if(s.mask[p]){const d=(p%s.bbox.width-x)**2+(Math.floor(p/s.bbox.width)-y)**2;if(d<distance){best=p;distance=d;}}
    return[s.bbox.x+best%s.bbox.width,s.bbox.y+Math.floor(best/s.bbox.width)];
  }
  async function infer(scrap) {
    worker ||= new Worker('./neural-worker.js',{type:'module'});
    const requestId=++sequence;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{worker.terminate();worker=null;reject(Error('Neural inference took too long. Try a smaller photo or another browser.'));},90000);
      worker.onmessage=({data})=>{if(data.requestId!==requestId)return;if(data.progress){$('scan-message').textContent=data.progress;return;}clearTimeout(timeout);data.error?reject(Error(data.error)):resolve(data);};
      worker.onerror=()=>{clearTimeout(timeout);worker.terminate();worker=null;reject(Error('The neural model could not start on this browser. Your existing plan is still available.'));};
      worker.postMessage({requestId,imageData:state.photo.getContext('2d').getImageData(0,0,state.photo.width,state.photo.height),prompt:promptInside(scrap),photoId:state.generation});
    });
  }
  $('neural-refine').onclick=async()=>{
    if(state.busy)return toast('Wait for the current analysis to finish.');
    if(!state.analysis||!state.selected)return toast('Select a fabric piece in the photo or material library first.');
    const scrap=state.analysis.scraps.find(s=>s.id===state.selected),generation=state.generation;
    state.busy=true;$('neural-refine').disabled=true;$('scan-overlay').hidden=false;
    try {
      const result=await infer(scrap);
      if(generation!==state.generation)throw Error('The photo changed. Select a piece again.');
      modal('A neural second look.',`<p><strong>SlimSAM · pretrained Segment Anything</strong> predicts the green region below from an interior point in your selected fabric. Review it against the photo. Applying keeps only pixels shared with the original material mask; it never expands the cutting boundary.</p><canvas id="neural-preview" class="neural-preview" aria-label="Actual SlimSAM predicted foreground over the source photograph"></canvas><p>Real local inference: ${(result.modelProvenance.elapsedMs/1000).toFixed(1)} seconds. Neural predictions can miss fabric or include the background. They do not establish fabric type, strength, or measurement accuracy.</p><button class="primary-button" id="neural-apply">Apply conservative edge refinement ↗</button><button class="text-button" id="neural-discard">Keep current boundary</button>`,'REAL NEURAL VISION · YOUR PHOTO STAYS LOCAL');
      const c=$('neural-preview');c.width=state.photo.width;c.height=state.photo.height;const ctx=c.getContext('2d');ctx.drawImage(state.photo,0,0);
      const layer=ctx.createImageData(c.width,c.height);for(let p=0;p<result.foregroundMask.length;p++)if(result.foregroundMask[p]){layer.data[p*4]=70;layer.data[p*4+1]=180;layer.data[p*4+2]=110;layer.data[p*4+3]=100;}
      const overlay=document.createElement('canvas');overlay.width=c.width;overlay.height=c.height;overlay.getContext('2d').putImageData(layer,0,0);ctx.drawImage(overlay,0,0);
      $('neural-discard').onclick=()=>$('info-dialog').close();
      $('neural-apply').onclick=async()=>{
        if(state.busy)return;state.busy=true;$('neural-apply').disabled=true;
        try {if(generation!==state.generation)throw Error('The photo changed. Run neural review again.');const response=await compute('refine',{scrapId:scrap.id,foregroundMask:result.foregroundMask,modelProvenance:result.modelProvenance});state.analysis=response.analysis;state.plan=response.plan;updateMetrics();$('neural-status').textContent='SLIMSAM APPLIED · '+response.analysis.neuralRefinement.removedPixels+' EDGE PIXELS REMOVED';$('info-dialog').close();toast('Neural boundary applied. Cutting geometry has been recalculated.');}catch(e){toast(e.message);$('neural-apply').disabled=false;}finally{state.busy=false;if(state.replanQueued){state.replanQueued=false;replan();}}
      };
    } catch(e){toast(e.message);$('neural-status').textContent='MODEL REVIEW UNAVAILABLE · CURRENT PLAN KEPT';}
    finally{state.busy=false;$('scan-overlay').hidden=true;$('neural-refine').disabled=false;if(state.replanQueued){state.replanQueued=false;replan();}}
  };
  window.addEventListener('beforeunload',()=>worker?.terminate());
}
