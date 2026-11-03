import {timeLabel,fmt,finite} from './data.js';

const tideInspectors=new WeakMap();
let tideInspectorId=0;
const svgNamespace='http://www.w3.org/2000/svg';
export function prepareTideSamples(points){
 const unique=new Map();
 for(const point of points??[])if(finite(point?.t)&&finite(point?.value))unique.set(point.t,{t:point.t,value:point.value});
 return [...unique.values()].sort((a,b)=>a.t-b.t);
}
// Select an existing plotted sample; never interpolate or extrapolate a value.
export function nearestTideSampleIndex(points,t){
 if(!points.length||!finite(t))return -1;
 let lo=0,hi=points.length-1;
 while(lo<hi){const middle=Math.floor((lo+hi)/2);if(points[middle].t<t)lo=middle+1;else hi=middle;}
 if(lo>0&&t-points[lo-1].t<=points[lo].t-t)return lo-1;
 return lo;
}
export function tidePlotPoint(point,plot){
 return {x:plot.left+(point.t-plot.timeStart)/(plot.timeEnd-plot.timeStart)*(plot.right-plot.left),
  y:plot.bottom-(point.value-plot.valueMin)/(plot.valueMax-plot.valueMin)*(plot.bottom-plot.top)};
}
function tideSvgElement(tag,attributes={}){
 const element=document.createElementNS(svgNamespace,tag);
 for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
 return element;
}
/** Attach after the chart's SVG is rendered. Returns a disposable cleanup function. */
export function attachTideInspector(container,{points=[],plot,units='ft'}={}){
 if(!container)return ()=>{};
 tideInspectors.get(container)?.();
 const svg=container.querySelector('svg');
 const keys=['left','right','top','bottom','width','height','timeStart','timeEnd','valueMin','valueMax'];
 if(!svg||!plot||!keys.every(key=>finite(plot[key]))||plot.right<=plot.left||plot.bottom<=plot.top||plot.timeEnd<=plot.timeStart||plot.valueMax<=plot.valueMin)return ()=>{};
 const samples=prepareTideSamples(points).filter(point=>point.t>=plot.timeStart&&point.t<=plot.timeEnd);
 if(!samples.length)return ()=>{};
 const oldRole=svg.getAttribute('role');
 svg.setAttribute('role','group');
 container.classList.add('tide-inspectable');
 const id=`tide-inspector-${++tideInspectorId}`;
 const tooltip=document.createElement('div');tooltip.className='tide-inspector-tooltip';tooltip.id=id;tooltip.hidden=true;tooltip.setAttribute('role','tooltip');
 const time=document.createElement('span'),height=document.createElement('strong');tooltip.append(time,height);
 const instruction=document.createElement('span');instruction.className='tide-inspector-sr';instruction.id=id+'-help';instruction.textContent='Move over the chart, drag, or use the left and right arrow keys to inspect tide predictions. Home and End jump to the ends; Escape closes the readout.';
 container.append(tooltip,instruction);
 const overlay=tideSvgElement('g',{'aria-hidden':'true',class:'tide-inspector-overlay',visibility:'hidden'});
 const vertical=tideSvgElement('line',{class:'tide-inspector-crosshair',y1:plot.top,y2:plot.bottom});
 const horizontal=tideSvgElement('line',{class:'tide-inspector-horizontal',x1:plot.left,x2:plot.right});
 const dot=tideSvgElement('circle',{class:'tide-inspector-dot',r:4});
 overlay.append(vertical,horizontal,dot);
 const target=tideSvgElement('rect',{x:plot.left,y:0,width:plot.right-plot.left,height:plot.height,
  class:'tide-inspector-target',tabindex:0,role:'slider','aria-label':'Inspect tide time and height',
  'aria-orientation':'horizontal','aria-valuemin':0,'aria-valuemax':samples.length-1,'aria-describedby':instruction.id});
 svg.append(overlay,target);
 let selected=Math.max(0,nearestTideSampleIndex(samples,Date.now()/1000)),pinned=false,dragging=false;
 const listeners=[];
 const on=(element,type,handler)=>{element.addEventListener(type,handler);listeners.push(()=>element.removeEventListener(type,handler));};
 const updateAria=()=>{
  const point=samples[selected],label=`${fmt(point.t,{weekday:'short',month:'short',day:'numeric'})}, ${timeLabel(point.t)} ET, ${point.value.toFixed(1)} ${units}`;
  target.setAttribute('aria-valuenow',String(selected));target.setAttribute('aria-valuetext',label);
 };
 const show=index=>{
  selected=Math.max(0,Math.min(samples.length-1,index));
  const point=samples[selected],position=tidePlotPoint(point,plot);
  vertical.setAttribute('x1',position.x);vertical.setAttribute('x2',position.x);
  horizontal.setAttribute('y1',position.y);horizontal.setAttribute('y2',position.y);
  dot.setAttribute('cx',position.x);dot.setAttribute('cy',position.y);overlay.setAttribute('visibility','visible');
  time.textContent=`${timeLabel(point.t)} ET`;height.textContent=`${point.value.toFixed(1)} ${units}`;
  tooltip.hidden=false;
  // Transform the actual SVG coordinate, accounting for responsive letterboxing.
  const matrix=svg.getScreenCTM(),box=container.getBoundingClientRect();
  let clientX;
  if(matrix){const p=svg.createSVGPoint();p.x=position.x;p.y=position.y;clientX=p.matrixTransform(matrix).x;}
  else{const rect=svg.getBoundingClientRect();clientX=rect.left+position.x/plot.width*rect.width;}
  const half=tooltip.offsetWidth/2;
  tooltip.style.left=`${Math.max(half+3,Math.min(box.width-half-3,clientX-box.left))}px`;
  updateAria();
 };
 const hide=()=>{overlay.setAttribute('visibility','hidden');tooltip.hidden=true;};
 const pointerIndex=event=>{
  const matrix=svg.getScreenCTM();let x;
  if(matrix){const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;x=p.matrixTransform(matrix.inverse()).x;}
  else{const rect=svg.getBoundingClientRect();x=(event.clientX-rect.left)/rect.width*plot.width;}
  const fraction=Math.max(0,Math.min(1,(x-plot.left)/(plot.right-plot.left)));
  return nearestTideSampleIndex(samples,plot.timeStart+fraction*(plot.timeEnd-plot.timeStart));
 };
 on(target,'pointermove',event=>{if(event.pointerType==='mouse'||dragging)show(pointerIndex(event));});
 on(target,'pointerdown',event=>{
  if(event.button!==0)return;
  pinned=true;dragging=true;target.focus({preventScroll:true});
  target.setPointerCapture?.(event.pointerId);show(pointerIndex(event));
 });
 on(target,'pointerup',event=>{dragging=false;if(target.hasPointerCapture?.(event.pointerId))target.releasePointerCapture(event.pointerId);});
 on(target,'pointercancel',()=>{dragging=false;pinned=false;hide();});
 on(target,'pointerleave',()=>{if(!pinned&&!dragging)hide();});
 on(target,'focus',()=>show(selected));
 on(target,'blur',()=>{pinned=false;dragging=false;hide();});
 on(target,'keydown',event=>{
  let next=selected;
  if(event.key==='ArrowLeft'||event.key==='ArrowDown')next--;
  else if(event.key==='ArrowRight'||event.key==='ArrowUp')next++;
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=samples.length-1;
  else if(event.key==='Escape'){event.preventDefault();pinned=false;hide();return;}
  else return;
  event.preventDefault();pinned=true;show(next);
 });
 updateAria();
 const cleanup=()=>{
  listeners.forEach(remove=>remove());overlay.remove();target.remove();tooltip.remove();instruction.remove();
  if(oldRole===null)svg.removeAttribute('role');else svg.setAttribute('role',oldRole);
  container.classList.remove('tide-inspectable');
  if(tideInspectors.get(container)===cleanup)tideInspectors.delete(container);
 };
 tideInspectors.set(container,cleanup);
 return cleanup;
}
