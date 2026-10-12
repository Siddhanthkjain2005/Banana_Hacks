// Real pretrained SlimSAM inference. The encoder, decoder and runtime are hosted
// with the app; neither the photograph nor the prompt leaves this worker.
let runtime, modelPromise, cached;
async function engine(requestId) {
  runtime ||= await import('./vendor/ai/transformers.min.js');
  const {env, SamModel, AutoProcessor}=runtime;
  env.allowRemoteModels=false;env.allowLocalModels=true;
  env.localModelPath=new URL('./models/',self.location.href).href;
  env.backends.onnx.wasm.wasmPaths=new URL('./vendor/ai/',self.location.href).href;
  env.backends.onnx.wasm.numThreads=1;
  modelPromise ||= Promise.all([
    SamModel.from_pretrained('slimsam',{quantized:true,local_files_only:true,progress_callback:e=>{
      if(e.status==='progress')self.postMessage({requestId,progress:'Loading neural weights: '+Math.round(e.progress||0)+'%'});
    }}),AutoProcessor.from_pretrained('slimsam',{local_files_only:true})
  ]).catch(e=>{modelPromise=null;throw e;});
  return modelPromise;
}
self.onmessage=async({data})=>{
  const {requestId,imageData,prompt,photoId}=data;
  try {
    if(!imageData?.data||!Array.isArray(prompt)||prompt.length!==2)throw Error('Provide an image and a point inside the selected fabric.');
    const started=performance.now();
    self.postMessage({requestId,progress:'Loading SlimSAM encoder and mask decoder…'});
    const [model,processor]=await engine(requestId);
    const image=new runtime.RawImage(imageData.data,imageData.width,imageData.height,4);
    const inputs=await processor(image,[[[prompt]]]);
    if(!cached||cached.photoId!==photoId){
      self.postMessage({requestId,progress:'Neural image encoder is reading your fabric…'});
      cached={photoId,embeddings:await model.get_image_embeddings(inputs)};
    }
    self.postMessage({requestId,progress:'Neural mask decoder is tracing the selected piece…'});
    const outputs=await model({...inputs,...cached.embeddings});
    const masks=await processor.post_process_masks(outputs.pred_masks,inputs.original_sizes,inputs.reshaped_input_sizes);
    const scores=Array.from(outputs.iou_scores.data),tensor=masks[0],pixels=imageData.width*imageData.height;
    let best=0;scores.forEach((score,i)=>{if(score>scores[best])best=i;});
    if(tensor.data.length!==pixels*scores.length)throw Error('The neural model returned an unexpected mask shape.');
    const foregroundMask=Uint8Array.from(tensor.data.subarray(best*pixels,(best+1)*pixels),v=>v?1:0);
    if(!foregroundMask.some(Boolean))throw Error('The neural model did not find a foreground mask. Select another interior point.');
    self.postMessage({requestId,foregroundMask,modelProvenance:{engine:'slimsam',modelId:'Xenova/slimsam-77-uniform',revision:'5850ab45f587c112167512ffef949107115e26a0',precision:'int8',runtime:'Transformers.js 2.17.2',elapsedMs:Math.round(performance.now()-started),prompt}},[foregroundMask.buffer]);
  } catch(error){self.postMessage({requestId,error:error.message});}
};
