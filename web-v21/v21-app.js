(()=>{
'use strict';
/* =========================================================
   0. Utilities
   ========================================================= */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const clamp=(v,a,b)=>v<a?a:v>b?b:v, lerp=(a,b,t)=>a+(b-a)*t;
const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const R=rng(20261118), rr=(a,b)=>a+(b-a)*R();
const icon=(id,cls='i sm')=>`<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const fmt=(v,d=2)=>Number(v).toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const rid=()=>Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,6);
const nowStr=()=>new Date().toLocaleTimeString('ja-JP',{hour12:false});
const dist3=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const SVGNS='http://www.w3.org/2000/svg';

/* =========================================================
   1. Site terrain model (analytic, used for splats + measurements)
   ========================================================= */
const VER={idx:5,p:1,s:1,list:[
  {d:'2026-10-02',label:'10/02',p:0.35,s:1.30},{d:'2026-10-16',label:'10/16',p:0.55,s:1.22},{d:'2026-10-30',label:'10/30',p:0.72,s:1.15},
  {d:'2026-11-06',label:'11/06',p:0.85,s:1.09},{d:'2026-11-13',label:'11/13',p:0.94,s:1.04},{d:'2026-11-18',label:'11/18',p:1,s:1}]};
const T={
  base:(x,z)=>0.12*Math.sin(x*0.13)*Math.cos(z*0.17)+0.08*Math.sin(x*0.31+z*0.23),
  hill:(x,z)=>6.2*Math.exp(-((x+32)**2+(z-6)**2)/60),
  embShape(x,z){const dx=Math.max(0,-8-x,x-4),dz=Math.max(0,Math.abs(z)-8);return Math.max(0,4-Math.max(dx,dz)/1.5)},
  dev(x,z){return 0.10*Math.sin(x*0.45)*Math.cos(z*0.38)+0.06*Math.sin(z*0.9+1.3)-0.52*Math.exp(-((x+3)**2+(z-4)**2)/12)+0.34*Math.exp(-((x-2)**2+(z+5)**2)/6)},
  embCur(x,z){const s=T.embShape(x,z);if(s<=0)return 0;const k=Math.min(1,s/0.6);return Math.max(0,s+T.dev(x,z)*k)},
  design(x,z){return T.base(x,z)+T.embShape(x,z)},
  embNow(x,z){return T.embCur(x,z)*VER.p},
  H(x,z){
    if(x>17.8&&x<=21.2)return -(x-18)*0.85;
    if(x>21.2&&x<34)return -2.8;
    if(x>=34&&x<37)return -2.8+(x-34)/3*2.8+T.base(x,z)*(x-34)/3;
    return T.base(x,z)+T.hill(x,z)*VER.s+T.embCur(x,z)*VER.p;
  }
};
const EXC={x:-19,z:7}; EXC.y=T.H(EXC.x,EXC.z);
const TRUCK_PATH={cx:-16,cz:-20,a:15,b:5};

/* =========================================================
   2. 3D Gaussian Splat scene generation
   ========================================================= */
const G={GROUND:0,EMB:1,HILL:2,REV:3,WATER:4,EXC_B:5,EXC_U:6,TRUCK:7,W1:8,W2:9,W3:10,TREE:11,OFFICE:12,DESIGN:13,CRACK:14};
const NG=15;
const LAYER_OF=['terrain','embankment','terrain','revetment','river','machine','machine','machine','worker','worker','worker','vegetation','terrain','design','revetment'];
const B={pos:[],col:[],size:[],alpha:[],grp:[],aux:[]};
const GR={};
function add(x,y,z,r,g,b,s,a,gp,aux=0){B.pos.push(x,y,z);B.col.push(clamp(r,0,1),clamp(g,0,1),clamp(b,0,1));B.size.push(s);B.alpha.push(a);B.grp.push(gp);B.aux.push(aux)}
const beginG=g=>{GR[g]={s:B.size.length}}, endG=g=>{GR[g].e=B.size.length};
function box(cx,cy,cz,sx,sy,sz,step,col,size,gp,jit=0.05,faceCol){
  const hx=sx/2,hy=sy/2,hz=sz/2;
  const face=(nx,ny,nz)=>{
    const ax=nx?['y','z']:ny?['x','z']:['x','y'];
    const ext={x:hx,y:hy,z:hz};
    for(let u=-ext[ax[0]];u<=ext[ax[0]]+1e-6;u+=step)for(let v=-ext[ax[1]];v<=ext[ax[1]]+1e-6;v+=step){
      const p={x:nx*hx,y:ny*hy,z:nz*hz};p[ax[0]]=u+rr(-jit,jit);p[ax[1]]=v+rr(-jit,jit);
      const c=(faceCol&&faceCol(nx,ny,nz,p))||col;const n=rr(-.03,.03);
      add(cx+p.x,cy+p.y,cz+p.z,c[0]+n,c[1]+n,c[2]+n,size,1,gp);
    }
  };
  face(1,0,0);face(-1,0,0);face(0,1,0);face(0,-1,0);face(0,0,1);face(0,0,-1);
}
function tube(pts,rad,step,col,size,gp){
  for(let k=0;k<pts.length-1;k++){const a=pts[k],b=pts[k+1];const L=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    for(let s=0;s<=L;s+=step){const t=s/L;const x=lerp(a[0],b[0],t),y=lerp(a[1],b[1],t),z=lerp(a[2],b[2],t);
      for(let q=0;q<5;q++){const an=q/5*Math.PI*2;const n=rr(-.03,.03);add(x,y+Math.cos(an)*rad,z+Math.sin(an)*rad,col[0]+n,col[1]+n,col[2]+n,size,1,gp)}}}
}
const CRACKS=[];
const LD=(()=>{const l=Math.hypot(-0.5,0.8,0.35);return[-0.5/l,0.8/l,0.35/l]})();
function lit(x,z){const e=0.35;const hx=(T.H(x+e,z)-T.H(x-e,z))/(2*e),hz=(T.H(x,z+e)-T.H(x,z-e))/(2*e);const l=Math.hypot(hx,1,hz);const d=(-hx*LD[0]+LD[1]-hz*LD[2])/l;return 0.55+0.55*Math.max(0,d)}
function buildScene(){
  // ---- ground / hill (static, world coords)
  for(let x=-46;x<=46;x+=1.12)for(let z=-33;z<=33;z+=1.12){
    const px=x+rr(-.35,.35),pz=z+rr(-.35,.35);
    if(px>17.8&&px<34)continue;
    if(T.embShape(px,pz)>0.02)continue;
    const y=T.H(px,pz),hh=T.hill(px,pz),n=rr(-.05,.05);
    const site=px>-42&&px<17.8&&pz>-28&&pz<28;
    const e=Math.hypot((px-TRUCK_PATH.cx)/TRUCK_PATH.a,(pz-TRUCK_PATH.cz)/TRUCK_PATH.b);
    let c,g=G.GROUND;
    if(px>=34||!site){c=[.27+n,.47+n*1.5,.22+n]}
    else if(hh>0.35){g=G.HILL;const gr=hh>4.6&&R()<.55;c=gr?[.33+n,.46+n,.22]:[.47+n+hh*.01,.35+n,.24+n]}
    else if(Math.abs(e-1)<0.13){c=[.55+n,.53+n,.5+n]}
    else{c=[.58+n,.46+n,.32+n]}
    const L=lit(px,pz);add(px,y,pz,c[0]*L,c[1]*L,c[2]*L,1.22,0.96,g);
  }
  // ---- embankment (denser for heatmap)
  for(let x=-15;x<=11;x+=0.7)for(let z=-15;z<=15;z+=0.7){
    const px=x+rr(-.2,.2),pz=z+rr(-.2,.2);const s=T.embShape(px,pz);if(s<=0.02)continue;
    const cur=T.embCur(px,pz),y=T.base(px,pz)+cur,d=cur-s,n=rr(-.035,.035);
    const band=(Math.floor(cur/0.5)%2)?0.045:0, stripe=(s>3.95&&Math.floor(px*1.3)%2)?-0.035:0;
    const L=lit(px,pz);add(px,y,pz,(.74+n+band+stripe)*L,(.6+n+band+stripe)*L,(.42+n+band*.6)*L,0.9,0.97,G.EMB,d);
  }
  // ---- revetment (block-type)
  beginG(G.REV);
  for(let x=17.8;x<=21.2;x+=0.37)for(let z=-33;z<=33;z+=0.37){
    const px=x+rr(-.06,.06),pz=z+rr(-.06,.06),y=-(px-18)*0.85,n=rr(-.04,.04);
    const joint=((pz+33)%2.0<0.24)||((px-17.8)%1.13<0.14);const c=joint?.47:.67;
    add(px,y,pz,c+n,c+n,c-.02+n,0.5,1,G.REV);
  }
  for(let z=-33;z<=33;z+=0.36)add(17.55,0.2,z+rr(-.04,.04),.82,.82,.8,0.3,1,G.REV);
  endG(G.REV);
  // ---- cracks
  beginG(G.CRACK);
  const cdef=[
    {id:'C-1',pl:[[18.35,-6.0],[18.9,-5.5],[19.3,-5.7],[19.9,-5.0],[20.5,-4.6]]},
    {id:'C-2',pl:[[18.4,3.9],[18.9,4.2],[19.4,4.0],[19.8,4.4]]},
    {id:'C-3',pl:[[18.7,12.8],[19.0,13.2],[19.3,13.3]]}];
  for(const c of cdef){
    const s=B.size.length;const pts=c.pl.map(([x,z])=>({x:x-0.03,y:-(x-18)*0.85+0.07,z}));
    let L=0;for(let k=0;k<pts.length-1;k++){const a=pts[k],b=pts[k+1];const l=dist3(a,b);L+=l;
      for(let u=0;u<=l;u+=0.05){const t=u/l;add(lerp(a.x,b.x,t)+rr(-.012,.012),lerp(a.y,b.y,t)+rr(-.012,.012),lerp(a.z,b.z,t)+rr(-.02,.02),.1,.09,.08,0.085,1,G.CRACK)}}
    CRACKS.push({id:c.id,pts,len:L,s,e:B.size.length});
  }
  endG(G.CRACK);
  // ---- water (dynamic: waves)
  beginG(G.WATER);
  for(let x=21.3;x<=34.2;x+=1.15)for(let z=-34;z<=34;z+=1.15){const n=rr(-.04,.04);add(x+rr(-.3,.3),-1.95,z+rr(-.3,.3),.15+n,.37+n,.62+n,0.95,0.84,G.WATER,rr(0,6.28))}
  endG(G.WATER);
  // ---- excavator (local coords; swing center at origin)
  const Y=[.96,.73,.12],DG=[.17,.17,.19];
  beginG(G.EXC_B);
  box(0,0.45,1.15,4.4,0.9,0.8,0.3,DG,0.24,G.EXC_B);box(0,0.45,-1.15,4.4,0.9,0.8,0.3,DG,0.24,G.EXC_B);
  box(0,1.0,0,1.4,0.3,1.4,0.3,[.3,.3,.32],0.22,G.EXC_B);
  endG(G.EXC_B);
  beginG(G.EXC_U);
  box(-0.2,1.6,0,3.0,1.1,2.5,0.28,Y,0.22,G.EXC_U);
  box(-1.85,1.65,0,0.7,1.1,2.4,0.28,[.82,.6,.1],0.22,G.EXC_U);
  box(0.75,2.65,0.75,1.1,1.2,1.0,0.22,Y,0.2,G.EXC_U,0.04,(nx,ny,nz,p)=>(nx===1&&p.y>-0.1)||(nz===1&&p.y>0)?[.16,.26,.38]:null);
  tube([[1.0,2.1,-0.35],[4.0,4.7,-0.35],[6.3,1.5,-0.35]],0.2,0.17,Y,0.2,G.EXC_U);
  box(6.4,0.9,-0.35,0.9,0.8,1.0,0.2,[.25,.25,.27],0.2,G.EXC_U);
  endG(G.EXC_U);
  // ---- dump truck (local; heading +x)
  beginG(G.TRUCK);
  box(0,0.75,0,5.4,0.35,2.0,0.3,[.2,.2,.22],0.22,G.TRUCK);
  box(2.1,1.7,0,1.3,1.5,2.0,0.25,[.88,.9,.93],0.21,G.TRUCK,0.04,(nx,ny,nz,p)=>nx===1&&p.y>0?[.15,.25,.38]:null);
  box(-0.85,1.55,0,3.5,1.1,2.1,0.28,[.9,.45,.15],0.22,G.TRUCK);
  for(let k=0;k<70;k++){const u=rr(-1.6,1.6),v=rr(-.9,.9);add(-0.85+u,2.15+0.35*(1-Math.abs(u)/1.7)*(1-Math.abs(v)),v,.5,.38,.25,0.26,1,G.TRUCK)}
  for(const wx of [1.9,-0.4,-1.9])for(const wz of [-1.0,1.0])box(wx,0.45,wz,0.8,0.8,0.35,0.22,[.08,.08,.09],0.2,G.TRUCK);
  endG(G.TRUCK);
  // ---- workers (local)
  for(const g of [G.W1,G.W2,G.W3]){
    beginG(g);
    for(const lz of [-0.13,0.13])for(let y=0.05;y<=0.86;y+=0.13)add(0,y,lz,.16,.2,.38,0.13,1,g);
    for(let y=0.92;y<=1.46;y+=0.11)for(let q=0;q<7;q++){const a=q/7*Math.PI*2;const st=Math.abs(y-1.2)<0.06;add(Math.cos(a)*0.2,y,Math.sin(a)*0.22,st?.95:1,st?.95:.55,st?.6:.1,0.12,1,g)}
    for(let q=0;q<6;q++)add(rr(-.08,.08),1.6+rr(-.05,.05),rr(-.08,.08),.82,.66,.52,0.11,1,g);
    for(let q=0;q<9;q++){const a=q/9*Math.PI*2;add(Math.cos(a)*0.13,1.76,Math.sin(a)*0.13,.97,.97,.97,0.12,1,g)}
    endG(g);
  }
  // ---- trees
  beginG(G.TREE);
  const trees=[[-44,-28],[-44,-14],[-44,0],[-44,15],[-43,28],[-30,31],[-14,31],[2,31],[12,30],[-30,-31],[-14,-31],[2,-31],[13,-30],[40,-24],[41,-8],[40,9],[42,24]];
  for(const [tx,tz] of trees){const ty=T.H(tx,tz);const h=rr(.85,1.25);
    for(let y=0;y<1.6*h;y+=0.25)add(tx,ty+y,tz,.35,.24,.15,0.2,1,G.TREE);
    for(let k=0;k<55;k++){const a=rr(0,6.28),r=Math.sqrt(R())*1.6*h,yy=rr(-1.2,1.4)*h;const n=rr(-.06,.06);add(tx+Math.cos(a)*r*(1-Math.abs(yy)/2.4),ty+2.9*h+yy,tz+Math.sin(a)*r*(1-Math.abs(yy)/2.4),.2+n,.45+n*1.4,.18+n,0.48,0.95,G.TREE)}}
  endG(G.TREE);
  // ---- site office
  const oy=T.H(-34,-21);
  box(-34,oy+1.35,-21,6,2.6,2.6,0.38,[.9,.92,.95],0.3,G.OFFICE,0.04,(nx,ny,nz,p)=>ny===1?[.35,.4,.5]:(nz===1&&Math.abs(p.y)<0.6&&Math.abs((p.x%1.5))<0.5)?[.25,.45,.7]:null);
  // ---- design surface (3D design data)
  beginG(G.DESIGN);
  for(let x=-14;x<=10;x+=0.9)for(let z=-14;z<=14;z+=0.9){const s=T.embShape(x,z);if(s<=0.02)continue;add(x,T.design(x,z)+0.06,z,.25,.9,1,0.2,0.75,G.DESIGN)}
  endG(G.DESIGN);
}
buildScene();
const N=B.size.length;
const P0=new Float32Array(B.pos),W=new Float32Array(B.pos),C0=new Float32Array(B.col);
const SZ=new Float32Array(B.size),AL=new Float32Array(B.alpha),GP=new Uint8Array(B.grp),AUX=new Float32Array(B.aux);

/* =========================================================
   3. Dynamics (excavator swing, truck haul, workers, water)
   ========================================================= */
const sim={excPaused:false,swing:0.2,t:0};
const rotY=(lx,lz,a)=>[lx*Math.cos(a)+lz*Math.sin(a),-lx*Math.sin(a)+lz*Math.cos(a)];
function workerPos(k,t){
  if(k===0){const x=-2+5*Math.sin(t*0.12),z=1+3*Math.sin(t*0.07);return{x,z}}
  if(k===1){const d=8.6+3.6*Math.cos(t*0.45);return{x:EXC.x+0.8*d,z:EXC.z-0.6*d}}
  return{x:15.4,z:-10+6*Math.sin(t*0.1)};
}
function truckPos(t){const th=t*0.22;return{x:TRUCK_PATH.cx+TRUCK_PATH.a*Math.cos(th),z:TRUCK_PATH.cz+TRUCK_PATH.b*Math.sin(th),dx:-TRUCK_PATH.a*Math.sin(th),dz:TRUCK_PATH.b*Math.cos(th)}}
function placeGroup(g,ox,oy,oz,ang){const r=GR[g];const c=Math.cos(ang),s=Math.sin(ang);
  for(let i=r.s;i<r.e;i++){const lx=P0[i*3],ly=P0[i*3+1],lz=P0[i*3+2];W[i*3]=ox+lx*c+lz*s;W[i*3+1]=oy+ly;W[i*3+2]=oz-lx*s+lz*c}}
function bucketWorld(){const[x,z]=rotY(6.4,-0.35,sim.swing);return{x:EXC.x+x,y:EXC.y+0.9,z:EXC.z+z}}
const workerState=[{},{},{}];
function updateDynamic(t,dt){
  sim.t=t;
  const r=GR[G.WATER];for(let i=r.s;i<r.e;i++)W[i*3+1]=-1.95+0.07*Math.sin(t*1.6+P0[i*3]*0.7+P0[i*3+2]*0.45+AUX[i]*.3);
  if(!sim.excPaused)sim.swing=0.95*Math.sin(t*0.55)+0.15;
  placeGroup(G.EXC_B,EXC.x,EXC.y,EXC.z,0.15);
  placeGroup(G.EXC_U,EXC.x,EXC.y,EXC.z,sim.swing);
  const tp=truckPos(t);placeGroup(G.TRUCK,tp.x,T.H(tp.x,tp.z),tp.z,Math.atan2(-tp.dz,tp.dx));
  [G.W1,G.W2,G.W3].forEach((g,k)=>{const p=workerPos(k,t),q=workerPos(k,t+0.08);const ang=Math.atan2(-(q.z-p.z),q.x-p.x);const y=T.H(p.x,p.z);placeGroup(g,p.x,y,p.z,ang);workerState[k]={x:p.x,y,z:p.z}});
}

/* =========================================================
   4. Camera & math (column-major, WebGPU 0..1 depth)
   ========================================================= */
const cam={yaw:0.75,pitch:0.62,dist:88,tx:-6,ty:0,tz:2,fov:50*Math.PI/180};
const VIEWS={
  all:{yaw:0.75,pitch:0.62,dist:88,tx:-6,ty:0,tz:2},
  emb:{yaw:0.42,pitch:0.62,dist:40,tx:-2,ty:2,tz:0},
  cut:{yaw:1.05,pitch:0.62,dist:42,tx:-27,ty:2,tz:3},
  exc:{yaw:0.85,pitch:0.8,dist:44,tx:-16,ty:1,tz:4},
  rev:{yaw:1.4,pitch:0.62,dist:24,tx:19.6,ty:-1.3,tz:4}
};
let M=new Float32Array(16),focal=800,Wc=800,Hc=600,eye={x:0,y:0,z:0};
function computeVP(){
  const cp=Math.cos(cam.pitch);eye={x:cam.tx+cam.dist*cp*Math.sin(cam.yaw),y:cam.ty+cam.dist*Math.sin(cam.pitch),z:cam.tz+cam.dist*cp*Math.cos(cam.yaw)};
  let zx=eye.x-cam.tx,zy=eye.y-cam.ty,zz=eye.z-cam.tz;let l=Math.hypot(zx,zy,zz);zx/=l;zy/=l;zz/=l;
  let xx=zz,xy=0,xz=-zx;l=Math.hypot(xx,xz)||1;xx/=l;xz/=l;
  const yx=zy*xz-zz*xy,yy=zz*xx-zx*xz,yz=zx*xy-zy*xx;
  const V=[xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0, -(xx*eye.x+xy*eye.y+xz*eye.z),-(yx*eye.x+yy*eye.y+yz*eye.z),-(zx*eye.x+zy*eye.y+zz*eye.z),1];
  const f=1/Math.tan(cam.fov/2),asp=Wc/Hc,near=0.5,far=600,nf=1/(near-far);
  const P=[f/asp,0,0,0, 0,f,0,0, 0,0,far*nf,-1, 0,0,far*near*nf,0];
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){let s=0;for(let k=0;k<4;k++)s+=P[k*4+r]*V[c*4+k];M[c*4+r]=s}
  focal=(Hc/2)*f;
}
function proj(p){const x=p.x,y=p.y,z=p.z;const w=M[3]*x+M[7]*y+M[11]*z+M[15];if(w<0.5)return null;
  const cx=M[0]*x+M[4]*y+M[8]*z+M[12],cy=M[1]*x+M[5]*y+M[9]*z+M[13];return{x:(cx/w*0.5+0.5)*Wc,y:(1-(cy/w*0.5+0.5))*Hc,w}}
let tween=null,lastFly=Promise.resolve();
function flyTo(v,dur=1300){lastFly=new Promise(res=>{const from={...cam};let dy=v.yaw-from.yaw;dy=((dy+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
  if(tween&&tween.res)tween.res();tween={from,to:{...from,...v,yaw:from.yaw+dy},p:0,dur,res}});return lastFly}

/* =========================================================
   5. Shading state & projection
   ========================================================= */
const ST={heatmap:false,privacy:true,crackHi:false,hi:new Map(),scan:null,layer:{terrain:1,embankment:1,revetment:1,river:1,machine:1,worker:1,vegetation:1,design:0,ai:1}};
const grpVis=new Uint8Array(NG);
function refreshVis(){for(let g=0;g<NG;g++)grpVis[g]=ST.layer[LAYER_OF[g]]?1:0}
refreshVis();
const SX=new Float32Array(N),SY=new Float32Array(N),SW=new Float32Array(N),VF=new Uint32Array(N);
let frameNo=1,sorted=[];
const grect=[];for(let g=0;g<NG;g++)grect.push({x0:0,y0:0,x1:0,y1:0,n:0});
function projectAll(){
  computeVP();frameNo++;
  for(const r of grect){r.x0=1e9;r.y0=1e9;r.x1=-1e9;r.y1=-1e9;r.n=0}
  const m0=M[0],m1=M[1],m3=M[3],m4=M[4],m5=M[5],m7=M[7],m8=M[8],m9=M[9],m11=M[11],m12=M[12],m13=M[13],m15=M[15];
  const vis=[];const hw=Wc*0.5,hh=Hc*0.5;
  for(let i=0;i<N;i++){
    const g=GP[i];if(!grpVis[g])continue;
    const x=W[i*3],y=W[i*3+1],z=W[i*3+2];const w=m3*x+m7*y+m11*z+m15;if(w<0.6)continue;
    const sx=((m0*x+m4*y+m8*z+m12)/w+1)*hw,sy=(1-(m1*x+m5*y+m9*z+m13)/w)*hh;
    const r=SZ[i]*focal/w+4;if(sx<-r||sx>Wc+r||sy<-r||sy>Hc+r)continue;
    SX[i]=sx;SY[i]=sy;SW[i]=w;VF[i]=frameNo;vis.push(i);
    const gr=grect[g];if(sx<gr.x0)gr.x0=sx;if(sx>gr.x1)gr.x1=sx;if(sy<gr.y0)gr.y0=sy;if(sy>gr.y1)gr.y1=sy;gr.n++;
  }
  vis.sort((a,b)=>SW[b]-SW[a]);sorted=vis;
}
const FOG=[.08,.14,.3];
const HEAT=[[-1,[.16,.39,1]],[-.5,[.19,.75,1]],[0,[.24,.88,.5]],[.5,[1,.83,.35]],[1,[1,.25,.25]]];
function heat(d){const t=clamp(d/0.4,-1,1);for(let k=0;k<HEAT.length-1;k++){const[a,ca]=HEAT[k],[b,cb]=HEAT[k+1];if(t<=b){const u=(t-a)/(b-a);return[lerp(ca[0],cb[0],u),lerp(ca[1],cb[1],u),lerp(ca[2],cb[2],u)]}}return HEAT[4][1]}
let cr=0,cg=0,cb=0,ca=1,cs=1;
function shade(i,t){
  let r=C0[i*3],g=C0[i*3+1],b=C0[i*3+2],a=AL[i],s=SZ[i];const gp=GP[i];
  if(gp===G.WATER){const w=0.5+0.5*Math.sin(t*2.2+AUX[i]+W[i*3]*0.5+W[i*3+2]*0.2);r+=w*.07;g+=w*.13;b+=w*.16}
  else if(gp===G.EMB&&ST.heatmap){const h=heat(AUX[i]);r=h[0];g=h[1];b=h[2]}
  else if(gp>=G.W1&&gp<=G.W3&&ST.privacy){r=.62;g=.52;b=.9;s*=2.3;a=.5}
  else if(gp===G.CRACK&&ST.crackHi){const p=.5+.5*Math.sin(t*5);r=1;g=.2+.2*p;b=.3;s*=2.6}
  else if(gp===G.DESIGN){const p=.5+.5*Math.sin(t*2+W[i*3]*0.3);a=.45+.35*p}
  if(gp<=G.REV)s*=1.15;
  const hc=ST.hi.get(gp);if(hc){const p=.35+.25*Math.sin(t*6);r=lerp(r,hc[0],p);g=lerp(g,hc[1],p);b=lerp(b,hc[2],p)}
  if(ST.scan){const v=ST.scan.axis==='z'?W[i*3+2]:W[i*3];const d=(v-ST.scan.pos)/1.4;const k=Math.exp(-d*d);if(k>0.01){r=lerp(r,.35,k*.85);g=lerp(g,1,k*.85);b=lerp(b,1,k*.85)}}
  const f=clamp((SW[i]-75)/170,0,.55);cr=lerp(r,FOG[0],f);cg=lerp(g,FOG[1],f);cb=lerp(b,FOG[2],f);ca=a;cs=s;
}

/* =========================================================
   6. Renderers: Canvas2D (sprite) + WebGPU (WGSL instanced gaussians)
   ========================================================= */
const sprites=new Map();
function sprite(r,g,b){
  const ri=(r*31+.5)|0,gi=(g*31+.5)|0,bi=(b*31+.5)|0,key=(ri<<10)|(gi<<5)|bi;let s=sprites.get(key);if(s)return s;
  s=document.createElement('canvas');s.width=s.height=32;const x=s.getContext('2d');const R8=ri*255/31|0,G8=gi*255/31|0,B8=bi*255/31|0;
  const gr=x.createRadialGradient(16,16,0,16,16,16);
  [[0,1],[.25,.78],[.5,.37],[.75,.11],[1,0]].forEach(([o,a])=>gr.addColorStop(o,`rgba(${R8},${G8},${B8},${a})`));
  x.fillStyle=gr;x.fillRect(0,0,32,32);sprites.set(key,s);return s;
}
function draw2D(ctx,t,w,h,noClear){
  if(!noClear)ctx.clearRect(0,0,w,h);let lastA=-1;
  for(let k=0;k<sorted.length;k++){const i=sorted[k];shade(i,t);const rad=Math.min(cs*focal/SW[i],90);if(rad<0.35)continue;
    if(ca!==lastA){ctx.globalAlpha=ca;lastA=ca}ctx.drawImage(sprite(cr,cg,cb),SX[i]-rad,SY[i]-rad,rad*2,rad*2)}
  ctx.globalAlpha=1;
}
const GPU={ok:false,device:null,ctx:null,pipe:null,ubuf:null,ibuf:null,vbuf:null,bind:null,data:null,info:''};
const WGSL=`
struct U{vp:mat4x4<f32>,p:vec4<f32>};
@group(0) @binding(0) var<uniform> u:U;
struct VO{@builtin(position) pos:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) col:vec4<f32>};
@vertex fn vs(@location(0) corner:vec2<f32>,@location(1) ps:vec4<f32>,@location(2) col:vec4<f32>)->VO{
  var o:VO; let c=u.vp*vec4<f32>(ps.xyz,1.0);
  let rpx=min(ps.w*u.p.z/max(c.w,0.01),90.0);
  let off=corner*rpx*2.0/u.p.xy*c.w;
  o.pos=vec4<f32>(c.xy+off,c.z,c.w); o.uv=corner; o.col=col; return o;
}
@fragment fn fs(i:VO)->@location(0) vec4<f32>{
  let d=dot(i.uv,i.uv); if(d>1.0){discard;}
  let a=exp(-4.0*d)*i.col.a; return vec4<f32>(i.col.rgb*a,a);
}`;
async function initGPU(canvas){
  if(!('gpu' in navigator))return 'navigator.gpu なし';
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)return 'アダプタ取得不可';
  const device=await adapter.requestDevice();
  const ctx=canvas.getContext('webgpu');if(!ctx)return 'webgpuコンテキスト不可';
  const format=navigator.gpu.getPreferredCanvasFormat();ctx.configure({device,format,alphaMode:'premultiplied'});
  device.pushErrorScope('validation');
  const mod=device.createShaderModule({code:WGSL});
  const pipe=device.createRenderPipeline({layout:'auto',
    vertex:{module:mod,entryPoint:'vs',buffers:[
      {arrayStride:8,stepMode:'vertex',attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]},
      {arrayStride:32,stepMode:'instance',attributes:[{shaderLocation:1,offset:0,format:'float32x4'},{shaderLocation:2,offset:16,format:'float32x4'}]}]},
    fragment:{module:mod,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},
    primitive:{topology:'triangle-list'}});
  const vbuf=device.createBuffer({size:48,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(vbuf,0,new Float32Array([-1,-1,1,-1,1,1,-1,-1,1,1,-1,1]));
  const ibuf=device.createBuffer({size:N*32,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const ubuf=device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const bind=device.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}}]});
  const err=await device.popErrorScope();if(err)return 'パイプライン検証エラー: '+err.message;
  device.addEventListener('uncapturederror',e=>{console.warn('WebGPU error',e.error);fallback2D('WebGPU実行時エラー → Canvas2Dへ切替')});
  device.lost.then(i=>{console.warn('WebGPU device lost',i.reason,i.message);if(GPU.ok)fallback2D('WebGPUデバイス喪失 → Canvas2Dへ切替')});
  const ai=adapter.info||{};
  Object.assign(GPU,{ok:true,adapter,device,ctx,pipe,ubuf,ibuf,vbuf,bind,data:new Float32Array(N*8),info:[ai.vendor,ai.architecture].filter(Boolean).join(' / ')||'adapter'});
  return null;
}
function drawGPU(t){
  const d=GPU.data;let n=0;
  for(let k=0;k<sorted.length;k++){const i=sorted[k];shade(i,t);const o=n*8;d[o]=W[i*3];d[o+1]=W[i*3+1];d[o+2]=W[i*3+2];d[o+3]=cs;d[o+4]=cr;d[o+5]=cg;d[o+6]=cb;d[o+7]=ca;n++}
  const dev=GPU.device;const u=new Float32Array(20);u.set(M,0);u[16]=Wc;u[17]=Hc;u[18]=focal;u[19]=t;
  dev.queue.writeBuffer(GPU.ubuf,0,u);if(n)dev.queue.writeBuffer(GPU.ibuf,0,d,0,n*8);
  const enc=dev.createCommandEncoder();
  const pass=enc.beginRenderPass({colorAttachments:[{view:GPU.ctx.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
  pass.setPipeline(GPU.pipe);pass.setBindGroup(0,GPU.bind);pass.setVertexBuffer(0,GPU.vbuf);pass.setVertexBuffer(1,GPU.ibuf);if(n)pass.draw(6,n);pass.end();
  dev.queue.submit([enc.finish()]);
}
let renderer='canvas2d';
const cvGpu=$('#cvGpu'),cv2d=$('#cv2d'),ctx2d=cv2d.getContext('2d');
function setRenderer(m){
  renderer=(m==='webgpu'&&GPU.ok)?'webgpu':'canvas2d';
  cvGpu.style.display=renderer==='webgpu'?'block':'none';cv2d.style.display=renderer==='canvas2d'?'block':'none';
  const label=renderer==='webgpu'?'WebGPU（WGSL・インスタンス描画）':'Canvas2D（フォールバック）';
  $('#hRend').textContent=label;$('#bdgGpu span').textContent='Renderer: '+(renderer==='webgpu'?'WebGPU':'Canvas2D');
  $('#bdgGpu').classList.toggle('warn',renderer!=='webgpu');
}
function fallback2D(msg){GPU.ok=false;setRenderer('canvas2d');window.SAS&&SAS.toast(msg,'alert','#ffb547')}

function setVersion(i){VER.idx=i;const v=VER.list[i];VER.p=v.p;VER.s=v.s;
  for(let k=0;k<N;k++){const g=GP[k];if(g===G.EMB){const x=P0[k*3],z=P0[k*3+2];const c=T.embCur(x,z)*VER.p;W[k*3+1]=T.base(x,z)+c;AUX[k]=c-T.embShape(x,z)}
    else if(g===G.HILL){const x=P0[k*3],z=P0[k*3+2];W[k*3+1]=P0[k*3+1]+T.hill(x,z)*(VER.s-1)}}}
window.__SAS_CORE={FOG,VER,setVersion,$,$$,clamp,lerp,ease,icon,fmt,esc,rid,nowStr,dist3,SVGNS,T,EXC,G,NG,LAYER_OF,GR,CRACKS,N,P0,W,C0,SZ,AL,GP,AUX,sim,workerState,bucketWorld,truckPos,cam,VIEWS,proj,flyTo,getLastFly:()=>lastFly,ST,refreshVis,SX,SY,SW,VF,grect,getFrame:()=>frameNo,getSorted:()=>sorted,projectAll,draw2D,shade,initGPU,drawGPU,GPU,setRenderer,getRenderer:()=>renderer,cvGpu,cv2d,ctx2d,
  getView:()=>({Wc,Hc,focal,eye}),setSize:(w,h)=>{Wc=w;Hc=h},updateDynamic,tweenStep:(dtms,mul)=>{if(!tween)return;tween.p+=dtms*mul/tween.dur;const e=ease(Math.min(1,tween.p));for(const k of ['yaw','pitch','dist','tx','ty','tz'])cam[k]=lerp(tween.from[k],tween.to[k],e);if(tween.p>=1){const r=tween.res;tween=null;r&&r()}},heat};
})();

(()=>{
'use strict';
const C=window.__SAS_CORE;
const {$,$$,clamp,lerp,ease,icon,fmt,esc,rid,nowStr,dist3,SVGNS,T,EXC,G,GR,CRACKS,N,W,GP,AUX,sim,workerState,cam,VIEWS,proj,flyTo,ST,SX,SY,SW,VF,grect}=C;
const vp=$('#vp'),ov=$('#ov'),tagsEl=$('#tags');
let dpr=1,Wc=800,Hc=600;
const st=document.createElement('style');
st.textContent='.ovl{stroke-linecap:round;stroke-linejoin:round}.ovl.dash{stroke-dasharray:8 6;animation:dash 1s linear infinite}';
document.head.appendChild(st);

/* ---------------- sizing ---------------- */
function resize(){const r=vp.getBoundingClientRect();dpr=Math.min(window.devicePixelRatio||1,1.5);Wc=Math.max(200,r.width|0);Hc=Math.max(200,r.height|0);C.setSize(Wc,Hc);
  for(const cv of [C.cv2d,C.cvGpu]){cv.width=Math.round(Wc*dpr);cv.height=Math.round(Hc*dpr)}ov.setAttribute('viewBox',`0 0 ${Wc} ${Hc}`)}
new ResizeObserver(resize).observe(vp);resize();

/* ---------------- toast / console ---------------- */
function toast(msg,ic='info',color='#38e1ff',ms=3800){const t=document.createElement('div');t.className='toast';t.style.setProperty('--c',color);t.innerHTML=icon(ic)+`<span>${msg}</span>`;$('#toasts').appendChild(t);setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),400)},ms)}
function con(msg){$('#conTx').textContent=`[${nowStr()}] ${msg}`}
const BUS={};window.SAS={toast,on:(t,f)=>(BUS[t]=BUS[t]||[]).push(f),emit:(t,d)=>(BUS[t]||[]).forEach(f=>{try{f(d)}catch(e){console.error(e)}})};const SAS=window.SAS;

/* =========================================================
   Overlays (SVG lines/polys/rings/bboxes + HTML tags/pins)
   ========================================================= */
const OVL=[];let ovSeq=0;
const val=v=>typeof v==='function'?v():v;
function svgEl(tag,attrs){const e=document.createElementNS(SVGNS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);ov.appendChild(e);return e}
function addOv(o){
  o.id=++ovSeq;o.kind=o.kind||'meas';o.els=[];const col=o.color||'#38e1ff';
  switch(o.type){
    case 'line':o.els.push(svgEl('line',{stroke:col,'stroke-width':2.4,class:'ovl dash'}));o.dots=[svgEl('circle',{r:4.5,fill:col,stroke:'#fff','stroke-width':1.2}),svgEl('circle',{r:4.5,fill:col,stroke:'#fff','stroke-width':1.2})];break;
    case 'poly':o.els.push(svgEl(o.open?'polyline':'polygon',{stroke:col,'stroke-width':2.2,fill:o.open?'none':col,'fill-opacity':.16,class:'ovl dash'}));break;
    case 'ring':o.els.push(svgEl('path',{stroke:col,'stroke-width':2.6,fill:col,'fill-opacity':.13,class:'ovl dash'}));o.els.push(svgEl('path',{stroke:col,'stroke-width':1.6,fill:'none',class:'ovl'}));break;
    case 'bbox':o.els.push(svgEl('rect',{stroke:col,'stroke-width':1,fill:col,'fill-opacity':.05,'stroke-opacity':.4,'stroke-dasharray':'3 4'}));o.els.push(svgEl('path',{stroke:col,'stroke-width':2.4,fill:'none',class:'ovl'}));break;
    case 'link':o.els.push(svgEl('line',{stroke:col,'stroke-width':1.8,class:'ovl dash'}));break;
    case 'dot':o.els.push(svgEl('circle',{r:5.5,fill:col,stroke:'#fff','stroke-width':1.5}));break;
  }
  if(o.type==='pin'){const d=document.createElement('div');d.className='pin';d.style.color=col;d.innerHTML=`<div class="pm" style="background:${col}">${icon(o.icon||'pin')}</div><div class="pl">${o.label}</div>`;tagsEl.appendChild(d);o.tag=d}
  else if(o.label!==undefined){const d=document.createElement('div');d.className='tag';d.style.color=col;d.innerHTML=o.label;tagsEl.appendChild(d);o.tag=d}
  o.born=performance.now();OVL.push(o);return o;
}
function removeOv(o){if(!o)return;o.els.forEach(e=>e.remove());o.dots&&o.dots.forEach(e=>e.remove());o.tag&&o.tag.remove();const k=OVL.indexOf(o);if(k>=0)OVL.splice(k,1)}
function clearOv(kind){[...OVL].filter(o=>!kind||o.kind===kind).forEach(removeOv)}
function rectOf(o){
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9,n=0;const fr=C.getFrame();
  if(o.range){for(let i=o.range[0];i<o.range[1];i++)if(VF[i]===fr){const x=SX[i],y=SY[i];if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;n++}}
  else for(const g of o.groups){const r=grect[g];if(!r.n)continue;n+=r.n;x0=Math.min(x0,r.x0);y0=Math.min(y0,r.y0);x1=Math.max(x1,r.x1);y1=Math.max(y1,r.y1)}
  if(n<2)return null;const pad=o.pad||6;return{x0:x0-pad,y0:y0-pad,x1:x1+pad,y1:y1+pad};
}
function updateOverlays(t){
  for(const o of OVL){
    const hidden=(o.kind==='det'&&!ST.layer.ai);let ok=!hidden,anchor=null;
    if(ok)switch(o.type){
      case 'line':case 'link':{const a=proj(val(o.a)),b=proj(val(o.b));if(!a||!b){ok=false;break}const e=o.els[0];e.setAttribute('x1',a.x);e.setAttribute('y1',a.y);e.setAttribute('x2',b.x);e.setAttribute('y2',b.y);
        if(o.dots){o.dots[0].setAttribute('cx',a.x);o.dots[0].setAttribute('cy',a.y);o.dots[1].setAttribute('cx',b.x);o.dots[1].setAttribute('cy',b.y)}
        if(o.colorFn){const c=o.colorFn();e.setAttribute('stroke',c);o.tag&&(o.tag.style.color=c)}
        anchor={x:(a.x+b.x)/2,y:(a.y+b.y)/2-8};break}
      case 'poly':{const ps=o.pts.map(proj);if(ps.some(p=>!p)){ok=false;break}o.els[0].setAttribute('points',ps.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' '));
        anchor={x:ps.reduce((s,p)=>s+p.x,0)/ps.length,y:Math.min(...ps.map(p=>p.y))-6};break}
      case 'ring':{const c=val(o.center);const mk=(R)=>{let d='';for(let k=0;k<=64;k++){const a=k/64*Math.PI*2;const p=proj({x:c.x+R*Math.cos(a),y:c.y+0.25,z:c.z+R*Math.sin(a)});if(!p)return null;d+=(k?'L':'M')+p.x.toFixed(1)+' '+p.y.toFixed(1)}return d+'Z'};
        const d1=mk(o.radius);if(!d1){ok=false;break}o.els[0].setAttribute('d',d1);const ph=(t*0.7)%1;const d2=mk(o.radius*(1+ph*0.35));if(d2){o.els[1].setAttribute('d',d2);o.els[1].setAttribute('opacity',(1-ph)*0.8)}
        const col=o.colorFn?o.colorFn():null;if(col){o.els.forEach(e=>{e.setAttribute('stroke',col);e.setAttribute('fill',e===o.els[0]?col:'none')});o.tag&&(o.tag.style.color=col)}
        const top=proj({x:c.x,y:c.y+0.25,z:c.z-o.radius});anchor=top?{x:top.x,y:top.y-6}:null;break}
      case 'bbox':{const r=rectOf(o);if(!r){ok=false;break}const L=Math.min(16,(r.x1-r.x0)/3,(r.y1-r.y0)/3);
        o.els[0].setAttribute('x',r.x0);o.els[0].setAttribute('y',r.y0);o.els[0].setAttribute('width',r.x1-r.x0);o.els[0].setAttribute('height',r.y1-r.y0);
        o.els[1].setAttribute('d',`M${r.x0} ${r.y0+L}V${r.y0}H${r.x0+L}M${r.x1-L} ${r.y0}H${r.x1}V${r.y0+L}M${r.x1} ${r.y1-L}V${r.y1}H${r.x1-L}M${r.x0+L} ${r.y1}H${r.x0}V${r.y1-L}`);
        anchor={x:(r.x0+r.x1)/2,y:r.y0-4};break}
      case 'pin':case 'dot':{const a=proj(val(o.p));if(!a){ok=false;break}if(o.type==='dot'){o.els[0].setAttribute('cx',a.x);o.els[0].setAttribute('cy',a.y)}anchor=a;break}
    }
    o.els.forEach(e=>e.style.display=ok?'':'none');o.dots&&o.dots.forEach(e=>e.style.display=ok?'':'none');
    if(o.tag){o.tag.style.display=ok&&anchor?'':'none';if(ok&&anchor){o.tag.style.left=anchor.x+'px';o.tag.style.top=anchor.y+'px';if(o.labelFn){const h=o.labelFn();if(h!==o._lh){o.tag.innerHTML=h;o._lh=h}}}}
  }
}

/* =========================================================
   Measurement / analysis functions (computed from the model)
   ========================================================= */
function pointInPoly(x,z,ps){let c=false;for(let i=0,j=ps.length-1;i<ps.length;j=i++){const a=ps[i],b=ps[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)c=!c}return c}
function polyArea(ps){let s=0;for(let i=0,j=ps.length-1;i<ps.length;j=i++)s+=(ps[j].x+ps[i].x)*(ps[j].z-ps[i].z);return Math.abs(s)/2}
function volumeCalc(ps,ref=0,step=0.5){let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;ps.forEach(p=>{x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);z0=Math.min(z0,p.z);z1=Math.max(z1,p.z)});
  let cut=0,fill=0,cells=0;const a=step*step;for(let x=x0+step/2;x<x1;x+=step)for(let z=z0+step/2;z<z1;z+=step){if(!pointInPoly(x,z,ps))continue;cells++;const h=T.H(x,z)-ref;if(h>0)cut+=h*a;else fill+=-h*a}
  return{cut,fill,area:polyArea(ps),cells};}
function embBalance(){let under=0,over=0,design=0,current=0;const a=0.25;for(let x=-14+0.25;x<10;x+=0.5)for(let z=-14+0.25;z<14;z+=0.5){const s=T.embShape(x,z);if(s<=0)continue;const c=T.embNow(x,z);design+=s*a;current+=c*a;if(c<s)under+=(s-c)*a;else over+=(c-s)*a}return{design,current,under,over}}
function devStats(tol=0.2){let n=0,s=0,ss=0,mn=1e9,mx=-1e9,imn=-1,imx=-1,pass=0,under=0,overc=0;
  for(let i=0;i<N;i++){if(GP[i]!==G.EMB)continue;const d=AUX[i];n++;s+=d;ss+=d*d;if(d<mn){mn=d;imn=i}if(d>mx){mx=d;imx=i}if(Math.abs(d)<=tol)pass++;else if(d<0)under++;else overc++}
  const mean=s/n,std=Math.sqrt(Math.max(0,ss/n-mean*mean));const P=i=>({x:W[i*3],y:W[i*3+1]+0.05,z:W[i*3+2]});
  return{n,mean,std,min:mn,max:mx,pass_rate:pass/n*100,out_under:under,out_over:overc,worstP:P(imn),maxP:P(imx)};}
function aabb(groups){const gs=new Set(groups);let x0=1e9,y0=1e9,z0=1e9,x1=-1e9,y1=-1e9,z1=-1e9,n=0;
  for(let i=0;i<N;i++){if(!gs.has(GP[i]))continue;n++;const x=W[i*3],y=W[i*3+1],z=W[i*3+2];if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;if(z<z0)z0=z;if(z>z1)z1=z}
  return{n,c:{x:(x0+x1)/2,y:(y0+y1)/2,z:(z0+z1)/2},d:{x:x1-x0,y:y1-y0,z:z1-z0},min:{x:x0,y:y0,z:z0},max:{x:x1,y:y1,z:z1}};}
function pick(sx,sy){const so=C.getSorted();let best=-1,bw=1e9;for(let k=0;k<so.length;k++){const i=so[k];if(GP[i]===G.DESIGN)continue;const dx=SX[i]-sx,dy=SY[i]-sy;if(dx*dx+dy*dy<144&&SW[i]<bw){bw=SW[i];best=i}}
  return best<0?null:{x:W[best*3],y:W[best*3+1],z:W[best*3+2],g:GP[best]};}

/* =========================================================
   Tools
   ========================================================= */
const TOOL={cur:'select',pts:[],temp:[],n:{dist:0,area:0,vol:0,note:0,haz:0},last:null};
const HINT={select:['orbit','視点操作：ドラッグ回転 / 右ドラッグ移動 / ホイール拡大'],distance:['ruler','距離：2点をクリック'],area:['area','面積：頂点をクリック →「範囲を確定」'],volume:['volume','土量：範囲の頂点をクリック →「範囲を確定」（基準高 ±0.00m）'],section:['section','断面：盛土上の位置をクリック（X方向の横断）'],annotate:['pin','注記：ピンを置く位置をクリック'],hazard:['hazard','危険域：重機付近をクリック（旋回半径を設定）']};
function clearTemp(){TOOL.temp.forEach(removeOv);TOOL.temp=[]}
function setTool(t){
  if(t==='capture'){capture();return}
  TOOL.cur=t;TOOL.pts=[];clearTemp();
  $$('#tools .tool[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===t));
  const h=HINT[t];$('#hTool').innerHTML=icon(h[0])+`<span>${h[1]}</span>`;$('#polyDone').classList.remove('show');
  vp.style.cursor=t==='select'?'grab':'crosshair';
}
$$('#tools .tool[data-tool]').forEach(b=>b.addEventListener('click',()=>{const t=b.dataset.tool;setTool(TOOL.cur===t&&t!=='select'?'select':t)}));
$('[data-toggle=heatmap]').addEventListener('click',e=>{ST.heatmap=!ST.heatmap;e.currentTarget.classList.toggle('on',ST.heatmap);$('#legend').classList.toggle('show',ST.heatmap);con(ST.heatmap?'出来形ヒートマップ ON':'出来形ヒートマップ OFF')});
function addResult(ic,title,value,color='#38e1ff'){const box=$('#results');const em=box.querySelector('.empty');em&&em.remove();const d=document.createElement('div');d.className='res';d.innerHTML=`<div class="rh" style="color:${color}">${icon(ic)}<span style="color:var(--tx)">${title}</span></div><div class="rv" style="color:${color}">${value}</div>`;box.prepend(d);while(box.children.length>9)box.lastChild.remove()}
function toolAt(p,o={}){
  switch(TOOL.cur){
    case 'distance':{TOOL.pts.push(p);if(TOOL.pts.length===1){TOOL.temp.push(addOv({type:'dot',p,color:o.color||'#38e1ff',kind:'temp'}));return}
      const[a,b]=TOOL.pts;clearTemp();TOOL.pts=[];const d=dist3(a,b),dh=Math.hypot(a.x-b.x,a.z-b.z),dv=b.y-a.y;const n=++TOOL.n.dist;const name=o.label||`距離 D-${n}`;
      addOv({type:'line',a,b,color:o.color||'#38e1ff',kind:o.kind||'meas',label:`${icon('ruler')}<span>${name}　${fmt(d)} m</span><em>水平 ${fmt(dh)} / 高低 ${fmt(dv)}</em>`});
      addResult('ruler',name,`${fmt(d)} m（水平 ${fmt(dh)} m）`,o.color||'#38e1ff');TOOL.last={d,dh,dv,a,b};con(`${name}: ${fmt(d)} m`);return TOOL.last}
    case 'area':case 'volume':{TOOL.pts.push(p);clearTemp();const col=TOOL.cur==='area'?'#3ee07f':'#ffb547';
      TOOL.temp.push(addOv({type:'poly',pts:[...TOOL.pts],color:col,kind:'temp',open:TOOL.pts.length<3}));TOOL.pts.forEach(q=>TOOL.temp.push(addOv({type:'dot',p:q,color:col,kind:'temp'})));
      $('#polyDone').classList.toggle('show',TOOL.pts.length>=3);return}
    case 'section':return openSection(p);
    case 'annotate':{const n=++TOOL.n.note;const lab=o.label||`注記 #${n}`;addOv({type:'pin',p,color:o.color||'#ffb547',icon:o.icon||'pin',label:lab,kind:'pin'});addResult('pin',`注記 #${n}`,lab,o.color||'#ffb547');con('注記を追加: '+lab);return}
    case 'hazard':{let c=p;if(Math.hypot(p.x-EXC.x,p.z-EXC.z)<6)c={x:EXC.x,y:EXC.y,z:EXC.z};const R=o.radius||7.5;const n=++TOOL.n.haz;
      const ring=addOv({type:'ring',center:c,radius:R,color:'#ff5d6c',kind:'hazard',colorFn:o.colorFn,label:`${icon('hazard')}<span>危険エリア HZ-0${n}</span><em>R=${fmt(R,1)}m</em>`});
      addResult('hazard',`危険エリア HZ-0${n}`,`半径 ${fmt(R,1)} m`,'#ff5d6c');TOOL.lastHazard=ring;con(`危険エリア HZ-0${n} を設定`);return ring}
  }
}
function finishPoly(){
  if(TOOL.pts.length<3)return null;const ps=[...TOOL.pts];const kind=TOOL.cur;clearTemp();TOOL.pts=[];$('#polyDone').classList.remove('show');
  if(kind==='area'){const a=polyArea(ps);const n=++TOOL.n.area;addOv({type:'poly',pts:ps,color:'#3ee07f',label:`${icon('area')}<span>面積 A-${n}　${fmt(a,1)} m²</span>`});addResult('area',`面積 A-${n}`,`${fmt(a,1)} m²`,'#3ee07f');TOOL.last={area:a,ps};con(`面積 A-${n}: ${fmt(a,1)} m²`);return TOOL.last}
  const v=volumeCalc(ps,0,0.5);const n=++TOOL.n.vol;addOv({type:'poly',pts:ps,color:'#ffb547',label:`${icon('volume')}<span>土量 V-${n}　切土 ${fmt(v.cut,0)} m³</span><em>面積 ${fmt(v.area,0)}m² ／ 基準高±0</em>`});
  addResult('volume',`土量 V-${n}`,`切土 ${fmt(v.cut,0)} m³／盛土 ${fmt(v.fill,0)} m³`,'#ffb547');TOOL.last={...v,ps};con(`土量 V-${n}: 切土 ${fmt(v.cut,0)} m³`);return TOOL.last;
}
$('#polyDone').addEventListener('click',finishPoly);

/* ---------- section ---------- */
let secLine=null;
function openSection(p){
  const z0=p.z;const xs=[];for(let x=-17;x<=13.001;x+=0.25)xs.push(x);
  const cur=xs.map(x=>T.base(x,z0)+T.embNow(x,z0)),des=xs.map(x=>T.embShape(x,z0)>0?T.design(x,z0):null);
  let worst=0,wx=0;xs.forEach((x,k)=>{if(des[k]!==null){const d=cur[k]-des[k];if(Math.abs(d)>Math.abs(worst)){worst=d;wx=x}}});
  $('#secTitle').textContent=`横断面 Z=${fmt(z0,1)}m（X方向）─ 現況 vs 設計　最大偏差 ${worst>=0?'+':''}${fmt(worst)} m @X=${fmt(wx,1)}`;
  $('#section').classList.add('show');
  removeOv(secLine);const pl=[];for(let x=-17;x<=13;x+=1)pl.push({x,y:T.H(x,z0)+0.2,z:z0});secLine=addOv({type:'poly',open:true,pts:pl,color:'#ff7ad9',kind:'sec',label:`${icon('section')}<span>断面 Z=${fmt(z0,1)}</span>`});
  const t0=performance.now();const anim=()=>{const pr=Math.min(1,(performance.now()-t0)/900);drawSection(xs,cur,des,pr,worst,wx);if(pr<1)requestAnimationFrame(anim)};anim();
  addResult('section',`断面 Z=${fmt(z0,1)}m`,`最大偏差 ${worst>=0?'+':''}${fmt(worst)} m`,'#ff7ad9');con(`横断面 Z=${fmt(z0,1)} を表示`);
  return{z:z0,worst,wx};
}
$('#secClose').addEventListener('click',()=>{$('#section').classList.remove('show');removeOv(secLine);secLine=null});
function drawSection(xs,cur,des,pr,worst,wx){
  const cv=$('#secCv'),x=cv.getContext('2d'),w=cv.width,h=cv.height,L=70,Rm=24,Tm=26,Bm=44;x.clearRect(0,0,w,h);
  const X=v=>L+(v+17)/30*(w-L-Rm),Y=v=>Tm+(1-(v+0.6)/5.4)*(h-Tm-Bm);
  x.strokeStyle='rgba(140,170,255,.13)';x.lineWidth=1;x.fillStyle='#8a9ac4';x.font='18px sans-serif';
  for(let v=0;v<=4;v+=1){x.beginPath();x.moveTo(L,Y(v));x.lineTo(w-Rm,Y(v));x.stroke();x.fillText(v.toFixed(1),L-44,Y(v)+6)}
  for(let v=-15;v<=13;v+=5){x.beginPath();x.moveTo(X(v),Tm);x.lineTo(X(v),h-Bm);x.stroke();x.fillText(v+'m',X(v)-14,h-14)}
  const lim=-17+30*pr;x.save();x.beginPath();x.rect(0,0,X(lim),h);x.clip();
  for(let k=0;k<xs.length-1;k++){if(des[k]===null||des[k+1]===null)continue;const d=cur[k]-des[k];x.fillStyle=Math.abs(d)>0.2?(d<0?'rgba(255,93,108,.55)':'rgba(255,181,71,.5)'):'rgba(62,224,127,.25)';
    x.beginPath();x.moveTo(X(xs[k]),Y(cur[k]));x.lineTo(X(xs[k+1]),Y(cur[k+1]));x.lineTo(X(xs[k+1]),Y(des[k+1]));x.lineTo(X(xs[k]),Y(des[k]));x.fill()}
  x.lineWidth=3;x.strokeStyle='#f0a85a';x.beginPath();xs.forEach((v,k)=>k?x.lineTo(X(v),Y(cur[k])):x.moveTo(X(v),Y(cur[k])));x.stroke();
  x.setLineDash([10,7]);x.strokeStyle='#38e1ff';x.beginPath();let st=false;xs.forEach((v,k)=>{if(des[k]===null){st=false;return}st?x.lineTo(X(v),Y(des[k])):x.moveTo(X(v),Y(des[k]));st=true});x.stroke();x.setLineDash([]);x.restore();
  if(pr>=1){x.fillStyle='#ff5d6c';x.beginPath();x.arc(X(wx),Y(T.base(wx,0)+0),0,0,0);x.fill();x.strokeStyle='#ff7ad9';x.lineWidth=2;x.beginPath();x.moveTo(X(wx),Tm);x.lineTo(X(wx),h-Bm);x.stroke();x.fillStyle='#ff9be3';x.fillText(`最大偏差 ${worst>=0?'+':''}${worst.toFixed(2)}m`,X(wx)+8,Tm+18)}
  x.font='17px sans-serif';x.fillStyle='#f0a85a';x.fillRect(w-330,8,22,4);x.fillText('現況（3DGS）',w-300,16);x.fillStyle='#38e1ff';x.fillRect(w-170,8,22,4);x.fillText('設計面',w-140,16);x.fillStyle='#8a9ac4';x.fillText('標高(m)',6,20);
}

/* ---------- capture ---------- */
function snapshot(){
  const cv=document.createElement('canvas');cv.width=Wc;cv.height=Hc;const x=cv.getContext('2d');
  const g=x.createRadialGradient(Wc/2,-Hc*.1,10,Wc/2,-Hc*.1,Hc*1.3);const lt=document.documentElement.dataset.theme==='light';(lt?[[0,'#ffffff'],[.4,'#dbe9ff'],[.75,'#c3d8f5'],[1,'#b4cbee']]:[[0,'#2b4a8e'],[.38,'#142453'],[.7,'#0a1230'],[1,'#070b18']]).forEach(([o,c])=>g.addColorStop(o,c));x.fillStyle=g;x.fillRect(0,0,Wc,Hc);
  C.draw2D(x,performance.now()/1000,Wc,Hc,true);
  x.lineWidth=2;x.font='12px sans-serif';
  for(const o of OVL){if(o.kind==='det'&&!ST.layer.ai)continue;if(o.kind==='temp')continue;const col=o.colorFn?o.colorFn():(o.color||'#38e1ff');x.strokeStyle=col;x.fillStyle=col;let an=null;
    if(o.type==='line'||o.type==='link'){const a=proj(val(o.a)),b=proj(val(o.b));if(!a||!b)continue;x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.stroke();an={x:(a.x+b.x)/2,y:(a.y+b.y)/2-8}}
    else if(o.type==='poly'){const ps=o.pts.map(proj);if(ps.some(p=>!p))continue;x.beginPath();ps.forEach((p,k)=>k?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));if(!o.open)x.closePath();x.stroke();an={x:ps[0].x,y:ps[0].y-8}}
    else if(o.type==='ring'){const c=val(o.center);x.beginPath();let okr=true;for(let k=0;k<=48;k++){const a=k/48*Math.PI*2;const p=proj({x:c.x+o.radius*Math.cos(a),y:c.y+.25,z:c.z+o.radius*Math.sin(a)});if(!p){okr=false;break}k?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y)}if(!okr)continue;x.stroke();const p=proj({x:c.x,y:c.y,z:c.z-o.radius});an=p}
    else if(o.type==='bbox'){const r=rectOf(o);if(!r)continue;x.strokeRect(r.x0,r.y0,r.x1-r.x0,r.y1-r.y0);an={x:r.x0+40,y:r.y0-4}}
    else if(o.type==='pin'){const a=proj(o.p);if(!a)continue;x.beginPath();x.arc(a.x,a.y-10,7,0,7);x.fill();an={x:a.x+40,y:a.y-14}}
    if(an&&o.tag){const tx=o.tag.textContent.trim();const tw=x.measureText(tx).width+12;x.fillStyle='rgba(8,14,34,.88)';x.fillRect(an.x-tw/2,an.y-15,tw,18);x.strokeStyle=col;x.lineWidth=1;x.strokeRect(an.x-tw/2,an.y-15,tw,18);x.lineWidth=2;x.fillStyle='#e6ecff';x.fillText(tx,an.x-tw/2+6,an.y-2)}}
  x.fillStyle='rgba(8,14,34,.7)';x.fillRect(0,Hc-24,Wc,24);x.fillStyle='#9fb0d8';x.font='12px monospace';x.fillText(`Spatial Agent Studio | ${new Date().toLocaleString('ja-JP')} | ${C.getRenderer()} | splats ${N}`,10,Hc-8);
  return cv.toDataURL('image/jpeg',0.84);
}
function capture(silent){
  const f=$('#flash');f.classList.remove('go');void f.offsetWidth;f.classList.add('go');
  const url=snapshot();
  if(!silent){const gal=$('#gallery');const em=gal.querySelector('.empty');em&&em.remove();const im=new Image();im.src=url;im.title=nowStr();gal.prepend(im);while(gal.children.length>8)gal.lastChild.remove();toast('ビューポートをキャプチャしました','camera','#38e1ff',2200);con('キャプチャ保存')}
  return url;
}

/* ---------- layers & UI wiring ---------- */
const LAYERS=[['terrain','地形・仮設','#8d7a52'],['embankment','盛土','#d6b07a'],['revetment','護岸','#a8acb4'],['river','河川','#3a7fd0'],['machine','重機・車両','#f2b72a'],['worker','作業員','#ff8c2a'],['vegetation','植生','#4f9a4a'],['design','設計面（3D設計データ）','#38e1ff'],['ai','AIオーバーレイ','#ffb547']];
$('#layers').innerHTML=LAYERS.map(([k,n,c])=>`<button class="layer ${ST.layer[k]?'on':''}" data-layer="${k}"><i class="sw" style="background:${c};box-shadow:0 0 6px ${c}"></i>${n}<span class="tg"></span></button>`).join('');
$$('#layers .layer').forEach(b=>b.addEventListener('click',()=>{const k=b.dataset.layer;ST.layer[k]=ST.layer[k]?0:1;b.classList.toggle('on',!!ST.layer[k]);C.refreshVis();con(`レイヤ「${b.textContent.trim()}」 ${ST.layer[k]?'表示':'非表示'}`)}));
$('#privToggle').addEventListener('click',e=>{ST.privacy=!ST.privacy;e.currentTarget.classList.toggle('on',ST.privacy);con('人物の自動匿名化 '+(ST.privacy?'ON':'OFF'));if(!ST.privacy)toast('匿名化OFF：本番運用では原則ONを推奨（個人の特定・監視につながる情報をAIへ渡さない）','mask','#ffb547',5200)});
$$('.vbtn[data-view]').forEach(b=>b.addEventListener('click',()=>{flyTo(VIEWS[b.dataset.view]);con(`視点「${b.textContent.trim()}」へ移動`)}));
$('#hRend').parentElement.style.cursor='pointer';
$('#hRend').parentElement.addEventListener('click',()=>{if(!C.GPU.ok){toast('この環境ではWebGPUが利用できないため Canvas2D で描画しています','gpu','#ffb547');return}C.setRenderer(C.getRenderer()==='webgpu'?'canvas2d':'webgpu');toast('レンダラ切替: '+C.getRenderer(),'gpu','#8b7bff',2000)});

/* ---------- pointer controls ---------- */
let drag=null;
vp.addEventListener('contextmenu',e=>e.preventDefault());
vp.addEventListener('pointerdown',e=>{if(e.target.closest('.hud,#section,#banner,#verBar'))return;drag={x:e.clientX,y:e.clientY,b:e.button,shift:e.shiftKey,moved:0};vp.setPointerCapture(e.pointerId);if(TOOL.cur==='select')vp.style.cursor='grabbing'});
vp.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved+=Math.abs(dx)+Math.abs(dy);drag.x=e.clientX;drag.y=e.clientY;
  if(drag.b===2||drag.shift){const k=cam.dist*0.0016;const rx=Math.cos(cam.yaw),rz=-Math.sin(cam.yaw),fx=-Math.sin(cam.yaw),fz=-Math.cos(cam.yaw);cam.tx-=rx*dx*k-fx*dy*k;cam.tz-=rz*dx*k-fz*dy*k}
  else{cam.yaw-=dx*0.006;cam.pitch=clamp(cam.pitch+dy*0.005,0.08,1.45)}});
vp.addEventListener('pointerup',e=>{if(!drag)return;const d=drag;drag=null;if(TOOL.cur==='select')vp.style.cursor='grab';
  if(d.moved<5&&d.b===0&&TOOL.cur!=='select'){const r=vp.getBoundingClientRect();const p=pick(e.clientX-r.left,e.clientY-r.top);if(p)toolAt(p);else toast('点群上をクリックしてください','info','#9fb0d8',1500)}});
vp.addEventListener('wheel',e=>{if(e.target.closest('#section'))return;e.preventDefault();cam.dist=clamp(cam.dist*Math.exp(e.deltaY*0.001),6,220)},{passive:false});

/* =========================================================
   Minimap
   ========================================================= */
const mm=$('#minimap'),mx=mm.getContext('2d'),MMW=mm.width,MMH=mm.height;
const mmX=x=>(x+46)/92*MMW,mmY=z=>(z+33)/66*MMH;
const mmBase=document.createElement('canvas');mmBase.width=MMW;mmBase.height=MMH;
function renderMMBase(){const x=mmBase.getContext('2d');const lt=document.documentElement.dataset.theme==='light';x.clearRect(0,0,MMW,MMH);x.fillStyle=lt?'#e8eef9':'#0b132e';x.fillRect(0,0,MMW,MMH);const idx=[];for(let i=0;i<N;i++){const g=GP[i];if(g<=G.WATER||g===G.TREE||g===G.OFFICE)idx.push(i)}idx.sort((a,b)=>W[a*3+1]-W[b*3+1]);
  for(const i of idx){const c=C.C0;x.fillStyle=`rgb(${c[i*3]*255|0},${c[i*3+1]*255|0},${c[i*3+2]*255|0})`;x.fillRect(mmX(W[i*3])-1,mmY(W[i*3+2])-1,2.4,2.4)}
  x.fillStyle=lt?'rgba(255,255,255,.12)':'rgba(7,11,24,.25)';x.fillRect(0,0,MMW,MMH)}renderMMBase();
function drawMinimap(t){
  mx.clearRect(0,0,MMW,MMH);mx.drawImage(mmBase,0,0);
  for(const o of OVL){if(o.type==='ring'){const c=val(o.center);mx.strokeStyle=o.colorFn?o.colorFn():o.color;mx.lineWidth=1.5;mx.beginPath();mx.ellipse(mmX(c.x),mmY(c.z),o.radius/92*MMW,o.radius/66*MMH,0,0,7);mx.stroke()}
    else if(o.type==='poly'&&!o.open){mx.strokeStyle=o.color;mx.lineWidth=1.2;mx.beginPath();o.pts.forEach((p,k)=>k?mx.lineTo(mmX(p.x),mmY(p.z)):mx.moveTo(mmX(p.x),mmY(p.z)));mx.closePath();mx.stroke()}}
  const b=C.bucketWorld();mx.strokeStyle='#f2b72a';mx.lineWidth=2;mx.beginPath();mx.moveTo(mmX(EXC.x),mmY(EXC.z));mx.lineTo(mmX(b.x),mmY(b.z));mx.stroke();mx.fillStyle='#f2b72a';mx.beginPath();mx.arc(mmX(EXC.x),mmY(EXC.z),3.5,0,7);mx.fill();
  const tp=C.truckPos(t);mx.fillStyle='#ff8a3a';mx.fillRect(mmX(tp.x)-3,mmY(tp.z)-3,6,6);
  workerState.forEach(w=>{mx.fillStyle=ST.privacy?'#b39bff':'#ff8c2a';mx.beginPath();mx.arc(mmX(w.x),mmY(w.z),2.6,0,7);mx.fill()});
  const e=C.getView().eye;const ex=mmX(e.x),ey=mmY(e.z),tx=mmX(cam.tx),ty=mmY(cam.tz);const a=Math.atan2(ty-ey,tx-ex);
  mx.fillStyle='rgba(56,225,255,.18)';mx.strokeStyle='#38e1ff';mx.lineWidth=1;mx.beginPath();mx.moveTo(clamp(ex,0,MMW),clamp(ey,0,MMH));mx.lineTo(tx+Math.cos(a+1.35)*18,ty+Math.sin(a+1.35)*18);mx.lineTo(tx+Math.cos(a-1.35)*18,ty+Math.sin(a-1.35)*18);mx.closePath();mx.fill();mx.stroke();
  mx.fillStyle='#9fb0d8';mx.font='9px sans-serif';mx.fillText('MAP  N↑',6,12);
}

/* ---------- 4D version bar ---------- */
let playing4D=false;
function buildVerBar(){const b=$('#verBar');b.innerHTML=`<button class="vplay" id="verPlay" title="4D再生（施工の進み具合）">${icon('play')}</button><span class="vlab">${icon('calendar')}4D 版</span>`+C.VER.list.map((v,i)=>`<button class="vchip ${i===C.VER.idx?'on':''} ${v.isNew?'new':''}" data-v="${i}" title="${v.d}　盛土進捗 ${Math.round(v.p*100)}%">${v.label}</button>`).join('');
  b.querySelectorAll('.vchip').forEach(c=>c.addEventListener('click',()=>setVersion(+c.dataset.v)));$('#verPlay').addEventListener('click',play4D)}
function setVersion(i,quiet){C.setVersion(i);renderMMBase();$$('#verBar .vchip').forEach(c=>c.classList.toggle('on',+c.dataset.v===i));const v=C.VER.list[i];
  if(!quiet){con(`4D：${v.d} の3DGS版を表示（盛土進捗 ${Math.round(v.p*100)}%）`);audit(AG.running?'AI:'+MNAME[uiModel()]:'HUMAN','VIEW_VERSION',v.d)}SAS.emit('version',i)}
async function play4D(){if(playing4D||AG.running)return;playing4D=true;$('#verPlay').innerHTML=icon('pause');for(let i=0;i<C.VER.list.length;i++){setVersion(i,true);await new Promise(r=>setTimeout(r,850))}con('4D再生：'+C.VER.list[0].d+' → '+C.VER.list[C.VER.list.length-1].d);$('#verPlay').innerHTML=icon('play');playing4D=false}
buildVerBar();

/* =========================================================
   Agent engine
   ========================================================= */
class Abort extends Error{}
const AG={running:false,paused:false,abort:false,speed:1,model:'claude',hitl:true,steps:0,acts:0,tools:0,tok:0,t0:0,ph:null,approveRes:null,detected:null,task:null};
const MODEL_INFO={claude:'claude-opus-5-5 ・ Messages API ・ computer use ＋ 業務ツール（tool use）',openai:'OpenAI 最新モデル ・ Responses API ・ computer use ＋ function calling',coop:'計画・空間推論・検証＝Claude ／ UI操作実行＝OpenAI（役割分担）'};
const PH={perceive:['知覚','eye','#38e1ff'],reason:['推論','brain','#8b7bff'],act:['操作','hand','#ffb547'],verify:['検証','shield','#3ee07f']};
const uiModel=()=>AG.model==='coop'?'openai':AG.model;
const fnModel=()=>AG.model==='coop'?'claude':AG.model;
const whoFor=ph=>AG.model==='coop'?(ph==='act'?'openai':'claude'):AG.model;
const MNAME={claude:'Claude',openai:'OpenAI'},MCOL={claude:'#f0956a',openai:'#36d6ad'},MICON={claude:'mA',openai:'mB'};
function updModel(){$('#mdlInfo').textContent=MODEL_INFO[AG.model];$$('#modelSeg button').forEach(b=>b.classList.toggle('on',b.dataset.m===AG.model))}
$$('#modelSeg button').forEach(b=>b.addEventListener('click',()=>{if(AG.running){toast('実行中はモデルを切り替えできません','lock','#ffb547');return}AG.model=b.dataset.m;updModel();con('エージェントモデル: '+b.textContent.trim());audit('HUMAN','CONFIG','モデル切替 → '+AG.model)}));
function wait(ms){return new Promise((res,rej)=>{let left=ms,last=performance.now();const tick=()=>{if(AG.abort)return rej(new Abort());const n=performance.now();if(!AG.paused)left-=(n-last)*AG.speed;last=n;if(left<=0)return res();setTimeout(tick,16)};setTimeout(tick,16)})}
function animate(ms,fn){return new Promise((res,rej)=>{let p=0,last=performance.now();const step=n=>{if(AG.abort)return rej(new Abort());if(!AG.paused)p=Math.min(1,p+(n-last)*AG.speed/ms);last=n;fn(p);if(p>=1)return res();requestAnimationFrame(step)};requestAnimationFrame(step)})}
function metrics(){$('#mAct').textContent=AG.acts;$('#mTool').textContent=AG.tools;$('#mTok').textContent=Math.round(AG.tok).toLocaleString();$('#loopN').textContent=AG.steps;$('#nTool').textContent=$('#p-tool').children.length}
setInterval(()=>{if(AG.running&&!AG.paused)$('#mTime').textContent=((performance.now()-AG.t0)/1000).toFixed(1)+'s'},100);

/* ---------- audit (hash chain) ---------- */
const AUD=[];let prevHash='GENESIS';
function fnv(s){let h1=0x811c9dc5,h2=0x9747b28c;for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1^=c;h1=Math.imul(h1,0x01000193)>>>0;h2^=c;h2=Math.imul(h2,0x5bd1e995)>>>0;h2^=h2>>>13}return(h1>>>0).toString(16).padStart(8,'0')+(h2>>>0).toString(16).padStart(8,'0')}
function audit(actor,type,detail){const e={seq:AUD.length+1,ts:new Date().toISOString(),actor,type,detail,prev:prevHash};e.hash=fnv(JSON.stringify(e));prevHash=e.hash;AUD.push(e);SAS.emit('audit',e);
  const col=actor.startsWith('AI:Claude')?'#f0956a':actor.startsWith('AI:OpenAI')?'#36d6ad':actor==='HUMAN'?'#3ee07f':'#9fb0d8';const short=actor==='HUMAN'?'人':actor==='SYSTEM'?'SYS':actor.replace('AI:','');
  const d=document.createElement('div');d.className='au';d.style.setProperty('--c',col);d.innerHTML=`<span class="t">${nowStr()}</span><span class="a" style="color:${col}">${short}</span><span>${esc(type)}：${esc(detail)}</span><span class="h">#${e.seq} ${e.hash}</span>`;
  const l=$('#audList');l.prepend(d);while(l.children.length>150)l.lastChild.remove();$('#nAud').textContent=AUD.length}
const aiActor=ph=>'AI:'+MNAME[whoFor(ph)];

/* ---------- timeline / phase / messages ---------- */
function tlAdd(ph,text,ic){const tl=$('#timeline');const ph0=tl.querySelector('.ph');ph0&&ph0.remove();tl.querySelectorAll('.st.cur').forEach(e=>e.classList.remove('cur'));
  if(tl.children.length){const a=document.createElement('span');a.className='arrow';a.innerHTML=icon('chev');tl.appendChild(a)}
  const c=PH[ph]?PH[ph][2]:'#9fb0d8';const s=document.createElement('span');s.className='st cur';s.style.setProperty('--c',c);s.innerHTML=icon(ic||(PH[ph]&&PH[ph][1])||'info')+esc(text);tl.appendChild(s);tl.scrollLeft=tl.scrollWidth}
function setPhase(ph){AG.ph=ph;AG.steps++;$$('#loop .node').forEach(n=>n.classList.toggle('on',n.dataset.ph===ph));tlAdd(ph,PH[ph][0],PH[ph][1]);metrics();
  const who=whoFor(ph);$('#bannerTx').textContent=`${MNAME[who]} が「${PH[ph][0]}」フェーズを実行中`}
async function phase(ph){setPhase(ph);await wait(250)}
function bubble(kind,who,ph,html){const p=$('#p-think');const d=document.createElement('div');
  if(kind==='user'){d.className='msg user';d.style.setProperty('--c','#38e1ff');d.innerHTML=`<div class="av">${icon('worker')}</div><div class="bd"><div class="who"><b>あなた</b>${nowStr()}</div><div class="tx">${html}</div></div>`}
  else{const c=MCOL[who];d.className='msg';d.style.setProperty('--c',c);d.innerHTML=`<div class="av">${icon(MICON[who])}</div><div class="bd"><div class="who"><b>${MNAME[who]}</b>${ph?`<span style="color:${PH[ph][2]}">${icon(PH[ph][1])} ${PH[ph][0]}</span>`:''}<span>${nowStr()}</span></div><div class="tx">${html||''}</div></div>`}
  p.appendChild(d);p.scrollTop=p.scrollHeight;return d.querySelector('.tx')}
async function say(ph,text){const who=whoFor(ph);const tx=bubble('ai',who,ph,'');const p=$('#p-think');
  for(let i=0;i<=text.length;i+=2){tx.innerHTML=esc(text.slice(0,i))+'<span class="caret"></span>';if(i%12===0)p.scrollTop=p.scrollHeight;await wait(14)}
  tx.textContent=text;p.scrollTop=p.scrollHeight;AG.tok+=text.length*1.3+60;metrics();SAS.emit('api',{model:who,kind:'message',name:'messages',tokens:text.length*1.3+60});audit(aiActor(ph),'THOUGHT',text.slice(0,60)+(text.length>60?'…':''));await wait(200)}

/* ---------- tool-call log (model-specific formats) ---------- */
function hj(o){let s=JSON.stringify(o,null,2);if(s.length>1800)s=s.slice(0,1800)+'\n…(省略)';s=s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  return s.replace(/("(?:[^"\\]|\\.)*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|\b(true|false|null)\b/g,(m,str,col,num,kw)=>str?(col?`<span class="k">${str}</span>${col}`:`<span class="s">${str}</span>`):`<span class="n">${num||kw}</span>`)}
function logBlock(who,title,obj,isRes){const p=$('#p-tool');const d=document.createElement('div');d.className='tc'+(isRes?' res':'');d.style.setProperty('--c',MCOL[who]);
  d.innerHTML=`<div class="tch">${icon(isRes?'checkc':MICON[who])}<b>${MNAME[who]}</b>${esc(title)}<em>${nowStr()}</em></div><pre>${hj(obj)}</pre>`;p.appendChild(d);p.scrollTop=p.scrollHeight;while(p.children.length>120)p.firstChild.remove();metrics()}
const r2=o=>JSON.parse(JSON.stringify(o,(k,v)=>typeof v==='number'?Math.round(v*100)/100:v));
function logComputer(a,label){
  const m=uiModel();AG.acts++;let req,res;
  if(m==='claude'){const id='toolu_'+rid();let input;
    if(a.type==='click')input={action:'left_click',coordinate:[a.x,a.y]};else if(a.type==='screenshot')input={action:'screenshot'};
    else if(a.type==='drag')input={action:'left_click_drag',start_coordinate:a.from,coordinate:a.to};else input={action:'scroll',coordinate:[a.x,a.y],scroll_direction:a.dy>0?'down':'up',scroll_amount:Math.abs(a.dy)};
    req={type:'tool_use',id,name:'computer',input};res={type:'tool_result',tool_use_id:id,content:a.type==='screenshot'?[{type:'image',source:{type:'base64',media_type:'image/png',data:'iVBORw0KGgoAAAANSUhEUg…（ビューポート画像・省略）'}}]:[{type:'text',text:'ok'}]}}
  else{const id='call_'+rid();let action;
    if(a.type==='click')action={type:'click',button:'left',x:a.x,y:a.y};else if(a.type==='screenshot')action={type:'screenshot'};
    else if(a.type==='drag')action={type:'drag',path:[{x:a.from[0],y:a.from[1]},{x:a.to[0],y:a.to[1]}]};else action={type:'scroll',x:a.x,y:a.y,scroll_x:0,scroll_y:a.dy*100};
    req={type:'computer_call',call_id:id,action,pending_safety_checks:[],status:'completed'};res={type:'computer_call_output',call_id:id,output:{type:'computer_screenshot',image_url:'data:image/png;base64,iVBORw0KGgo…（省略）'}}}
  logBlock(m,' ・ '+(label||a.type),req,false);if(a.type==='screenshot')logBlock(m,' ・ 結果',res,true);
  audit('AI:'+MNAME[m],'UI_ACTION',`${a.type}${a.x!==undefined?` (${a.x},${a.y})`:''} ${label||''}`);AG.tok+=a.type==='screenshot'?1600:90;metrics();SAS.emit('api',{model:m,kind:'computer',name:a.type,tokens:a.type==='screenshot'?1600:90});
}
async function fnTool(name,input,fn){
  const m=fnModel();AG.tools++;const id=(m==='claude'?'toolu_':'call_')+rid();
  logBlock(m,' ・ '+name,m==='claude'?{type:'tool_use',id,name,input:r2(input)}:{type:'function_call',call_id:id,name,arguments:JSON.stringify(r2(input))},false);
  tlAdd(AG.ph||'act',name,'api');audit('AI:'+MNAME[m],'TOOL_CALL',name);SAS.emit('api',{model:m,kind:'function',name,tokens:300});await wait(450);
  const out=await fn();const o2=r2(out||{});
  logBlock(m,' ・ '+name+' 結果',m==='claude'?{type:'tool_result',tool_use_id:id,content:JSON.stringify(o2)}:{type:'function_call_output',call_id:id,output:JSON.stringify(o2)},true);
  AG.tok+=JSON.stringify(o2).length*0.5+120;metrics();await wait(250);return out;
}

/* ---------- virtual cursor ---------- */
const curEl=$('#acur');const cur={x:0,y:0};
function setCur(x,y){cur.x=x;cur.y=y;curEl.style.transform=`translate(${x-4}px,${y-3}px)`}
function cursorStyle(){const m=uiModel();curEl.style.setProperty('--cc',MCOL[m]);$('#acurNm').textContent=MNAME[m]+' ・ computer use'}
function ripple(x,y){const r=document.createElement('div');r.className='ripple';r.style.left=x+'px';r.style.top=y+'px';r.style.setProperty('--cc',MCOL[uiModel()]);document.body.appendChild(r);setTimeout(()=>r.remove(),750)}
function trail(x,y){const r=document.createElement('div');r.className='trail';r.style.left=x+'px';r.style.top=y+'px';r.style.setProperty('--cc',MCOL[uiModel()]);document.body.appendChild(r);setTimeout(()=>r.remove(),620)}
async function moveCursor(x,y,act){$('#acurAct').textContent=act||'mouse_move';const sx=cur.x,sy=cur.y;const d=Math.hypot(x-sx,y-sy);const cx=(sx+x)/2+(y-sy)*0.2,cy=(sy+y)/2-(x-sx)*0.2;let k=0;
  await animate(380+d*0.55,p=>{const e=ease(p),u=1-e;const px=u*u*sx+2*u*e*cx+e*e*x,py=u*u*sy+2*u*e*cy+e*e*y;setCur(px,py);if(++k%3===0&&p<1)trail(px,py)})}
async function clickEl(sel,label){
  const el=typeof sel==='string'?$(sel):sel;if(!el)throw new Error('UI要素が見つかりません: '+sel);
  el.scrollIntoView({block:'nearest',inline:'nearest'});await wait(60);const r=el.getBoundingClientRect();const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);
  await moveCursor(x,y,'left_click');logComputer({type:'click',x,y},label);ripple(x,y);el.classList.remove('agent-hit');void el.offsetWidth;el.classList.add('agent-hit');setTimeout(()=>el.classList.remove('agent-hit'),800);
  el.click();tlAdd('act',label,'hand');await wait(330);
}
async function click3D(p,opts={},label){
  const s=proj(p);const r=vp.getBoundingClientRect();if(!s)throw new Error('対象が画面外です');const x=Math.round(r.left+s.x),y=Math.round(r.top+s.y);
  await moveCursor(x,y,'left_click');const s2=proj(p);const x2=Math.round(r.left+s2.x),y2=Math.round(r.top+s2.y);setCur(x2,y2);
  logComputer({type:'click',x:x2,y:y2},label||'3D点をクリック');ripple(x2,y2);const out=toolAt(p,opts);tlAdd('act',label||'3Dクリック','target');await wait(320);return out;
}
const POLICY={drag:true,scroll:true,screenshot:true};
async function denied(act,label){audit('GATEWAY','DENY',`ポリシーにより ${act} を拒否（${label}）`);SAS.emit('api',{model:uiModel(),kind:'computer',name:act,blocked:true,tokens:0});toast(`ポリシーで「${act}」は許可されていません → スキップ`,'lock','#ff5d6c',3200);tlAdd(AG.ph||'act',act+' 拒否','lock');await wait(350)}
async function dragView(dx){if(!POLICY.drag)return denied('left_click_drag','視点回転');const r=vp.getBoundingClientRect();const sx=Math.round(r.left+r.width*0.5-dx/2),sy=Math.round(r.top+r.height*0.58);await moveCursor(sx,sy,'left_click_drag');
  const yaw0=cam.yaw;ripple(sx,sy);let k=0;await animate(1100,p=>{const e=ease(p);setCur(sx+dx*e,sy-Math.sin(e*Math.PI)*16);cam.yaw=yaw0-dx*0.006*e;if(++k%3===0)trail(cur.x,cur.y)});
  logComputer({type:'drag',from:[sx,sy],to:[Math.round(sx+dx),sy]},'視点を回転（死角確認）');tlAdd('act','ドラッグ回転','drag');await wait(200)}
async function scrollView(steps,label){if(!POLICY.scroll)return denied('scroll',label||'ズーム');const r=vp.getBoundingClientRect();const x=Math.round(r.left+r.width*0.55),y=Math.round(r.top+r.height*0.5);await moveCursor(x,y,'scroll');const d0=cam.dist;
  await animate(900,p=>{cam.dist=d0*Math.pow(0.88,steps*ease(p))});logComputer({type:'scroll',x,y,dy:-steps},label||'ズーム');tlAdd('act',label||'ズーム','zoom');await wait(200)}
async function screenshot(label){if(!POLICY.screenshot){await denied('screenshot',label||'スクリーンショット');con('スクリーンショット不可 → シーングラフのみで判断');return}const sf=$('#scanframe');sf.classList.add('on');$('#acurAct').textContent='screenshot';const f=$('#flash');f.classList.remove('go');void f.offsetWidth;f.classList.add('go');
  logComputer({type:'screenshot'},label||'スクリーンショット取得');tlAdd(AG.ph||'perceive','スクリーンショット','camera');await wait(750);sf.classList.remove('on')}
async function ensureTool(t,label){if(C&&TOOL.cur!==t)await clickEl(`#tools [data-tool="${t}"]`,label||`ツール選択：${t}`)}
async function ensureToggle(on,label){if(ST.heatmap!==on)await clickEl('[data-toggle=heatmap]',label||'ヒートマップ切替')}
async function ensureLayer(k,on,label){if(!!ST.layer[k]!==on)await clickEl(`#layers [data-layer="${k}"]`,label||`レイヤ切替：${k}`)}
async function clickView(k,label){await clickEl(`.vbtn[data-view="${k}"]`,label||`視点：${k}`);await C.getLastFly()}

/* ---------- approval (Human-in-the-Loop) ---------- */
const ROLE={cur:'agent',defs:{
  field:{n:'現場担当者',sub:'現場A 施工管理',grp:'SG-現場A-施工管理',c:'#38e1ff',ic:'worker',approve:false,pages:['dash','viewer','pipeline','data','approvals','arch','roadmap'],can:['AIに計測・集計・帳票下書きを依頼する','3Dで現場状況を確認・計測する','撮影データをアップロードする（3DGS化）']},
  agent:{n:'現場代理人・所長',sub:'現場A 責任者',grp:'SG-現場A-代理人',c:'#3ee07f',ic:'shield',approve:true,pages:['dash','viewer','data','approvals','integration','audit','settings','arch','roadmap'],can:['AI下書きを確認して承認・却下する','是正指示・重機の停止指示を判断する','複数現場の状況を3Dで横断確認する']},
  hq:{n:'本社（工務・安全・品質）',sub:'本社 工務部',grp:'SG-本社-工務安全品質',c:'#8b7bff',ic:'office',approve:false,pages:['dash','viewer','data','approvals','integration','audit','settings','arch','roadmap'],can:['現場に行かずに3Dで状況を確認する','点検・安全パトロールを一部リモートで行う','全社のKPI・傾向を分析する']},
  it:{n:'IT・DX部門',sub:'情報システム',grp:'SG-IT-DX-Admin',c:'#ffb547',ic:'gpu',approve:false,pages:['dash','viewer','pipeline','data','approvals','integration','governance','audit','settings','arch','roadmap'],can:['AIゲートウェイ・権限・監査ログを管理する','APIコスト・GPU資源を管理する','操作許可・承認要否のポリシーを設定する']}}};
function setRole(k,silent){if(!ROLE.defs[k])return;ROLE.cur=k;const d=ROLE.defs[k];$('#roleName').textContent=d.n;const av=$('#roleAv');av.innerHTML=icon(d.ic);av.style.setProperty('--c',d.c);
  if(!silent){audit('HUMAN','SIGN_IN',`Cloudflare Access：${d.n}／${d.grp}`);toast(`${d.n} としてサインイン（${d.grp}）`,d.ic,d.c,3000)}
  if($('#mApprove').classList.contains('show'))updateApproveRole();SAS.emit('role',k)}
function updateApproveRole(){const d=ROLE.defs[ROLE.cur];const can=d.approve;$('#apYes').disabled=!can;$('#apNo').disabled=!can;$('#apSwitch').style.display=can?'none':'';
  $('#apRole').innerHTML=can?`承認者：${d.n}（${d.grp}）`:`<span style="color:var(--am)">「${d.n}」には承認権限がありません</span>`}
$('#apSwitch').addEventListener('click',()=>setRole('agent'));
const APPROVALS=[];
async function approve(spec){if(window.__SAS_REAL__&&window.__SAS_REAL__.approve)return window.__SAS_REAL__.approve(spec);
  tlAdd('verify','人間承認待ち','shield');audit(aiActor('verify'),'APPROVAL_REQUEST',spec.title);
  const rec={id:'AP-'+String(APPROVALS.length+101),site:'現場A',title:spec.title,desc:spec.desc,risk:spec.risk||'中',kv:spec.kv||[],img:spec.img,task:SC_NAME[AG.task]||'',model:AG.model,status:'pending',req:new Date().toISOString()};
  APPROVALS.push(rec);SAS.emit('approval',rec);SAS.emit('notify',{ic:'shield',c:'#ffb547',title:'承認依頼：'+spec.title,body:`${MNAME[whoFor('verify')]} が作成（影響度：${rec.risk}）。現場代理人の承認が必要です。`,act:'approvals'});
  if(!AG.hitl){await wait(400);audit('SYSTEM','AUTO_APPROVED',spec.title+'（デモ設定：人間承認OFF）');toast('人間承認がOFFのため自動承認しました（デモ設定）','shield','#ffb547');Object.assign(rec,{status:'auto',by:'自動（デモ設定）',at:new Date().toISOString()});SAS.emit('approval',rec);return{ok:true,auto:true,by:'自動（デモ設定）',at:rec.at}}
  $('#apTitle').textContent=spec.title;$('#apDesc').textContent=spec.desc;$('#apRisk').textContent='影響度：'+(spec.risk||'中');
  $('#apKv').innerHTML=(spec.kv||[]).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');const im=$('#apImg');if(spec.img){im.src=spec.img;im.style.display=''}else im.style.display='none';
  updateApproveRole();$('#mApprove').classList.add('show');$('#bannerTx').textContent='人間の承認を待っています';con('承認待ち: '+spec.title);
  const ok=await new Promise(res=>{AG.approveRes=res});AG.approveRes=null;$('#mApprove').classList.remove('show');
  const d=ROLE.defs[ROLE.cur];Object.assign(rec,{status:ok?'approved':'rejected',by:`${d.n}（${d.grp}）`,at:new Date().toISOString()});SAS.emit('approval',rec);
  audit('HUMAN',ok?'APPROVED':'REJECTED',spec.title+' / '+d.n);toast(ok?'承認されました：'+spec.title:'却下されました：'+spec.title,ok?'checkc':'x',ok?'#3ee07f':'#ff5d6c');
  if(AG.abort)throw new Abort();return{ok,by:rec.by,at:rec.at};
}
$('#apYes').addEventListener('click',()=>AG.approveRes&&AG.approveRes(true));
$('#apNo').addEventListener('click',()=>AG.approveRes&&AG.approveRes(false));

/* ---------- report store ---------- */
const REP=[];
function addReport(r){if(window.__SAS_REAL__&&window.__SAS_REAL__.addReport)return window.__SAS_REAL__.addReport(r);r.id='R-'+String(REP.length+1).padStart(3,'0');r.at=new Date().toISOString();r.model=AG.model;REP.push(r);audit('SYSTEM','REPORT_ADD',r.id+' '+r.title);SAS.emit('report',r);return r}

/* =========================================================
   Spatial understanding: scene graph from 3DGS
   ========================================================= */
const OBJDEF=[
  {k:'emb',n:'盛土（施工中）',ic:'volume',c:'#38e1ff',g:[G.EMB],cf:.97},
  {k:'hill',n:'切土対象（地山）',ic:'mountain',c:'#c79a62',g:[G.HILL],cf:.94},
  {k:'rev',n:'護岸（ブロック張）',ic:'wall',c:'#a8b4c8',g:[G.REV],cf:.96,nobox:true},
  {k:'river',n:'河川（水面）',ic:'river',c:'#3a9bff',g:[G.WATER],cf:.99,nobox:true},
  {k:'exc',n:'バックホウ',ic:'exc',c:'#f2b72a',g:[G.EXC_B,G.EXC_U],cf:.98},
  {k:'truck',n:'ダンプトラック',ic:'truck',c:'#ff8a3a',g:[G.TRUCK],cf:.95},
  {k:'w1',n:'作業員 W-01（匿名）',ic:'worker',c:'#b39bff',g:[G.W1],cf:.91},
  {k:'w2',n:'作業員 W-02（匿名）',ic:'worker',c:'#b39bff',g:[G.W2],cf:.89},
  {k:'w3',n:'作業員 W-03（匿名）',ic:'worker',c:'#b39bff',g:[G.W3],cf:.9},
  {k:'office',n:'仮設事務所',ic:'office',c:'#9fb0d8',g:[G.OFFICE],cf:.9}];
async function detectScene(){
  clearOv('det');const pane=$('#p-space');pane.innerHTML=`<div class="sec-h">${icon('cube')}シーングラフ（3DGS → 物体・3D BBox）</div>`;const out={};
  for(const d of OBJDEF){
    const bb=aabb(d.g);out[d.k]={...d,bb};
    if(!d.nobox)addOv({type:'bbox',groups:d.g,color:d.c,kind:'det',label:`${icon(d.ic)}<span>${d.n}</span><em>${Math.round(d.cf*100)}%</em>`});
    const el=document.createElement('div');el.className='sg-item';el.style.setProperty('--c',d.c);
    el.innerHTML=`<div class="ic">${icon(d.ic,'i')}</div><div><b>${d.n}</b><small>中心(${fmt(bb.c.x,1)}, ${fmt(bb.c.y,1)}, ${fmt(bb.c.z,1)}) ／ ${fmt(bb.d.x,1)}×${fmt(bb.d.z,1)}×${fmt(bb.d.y,1)}m ／ ${bb.n} splats</small></div><div class="cf">${Math.round(d.cf*100)}%<i style="width:${d.cf*100}%"></i></div>`;
    pane.appendChild(el);$('#nObj').textContent=Object.keys(out).length;await wait(170);
  }
  const wmin=Math.min(...workerState.map(w=>Math.hypot(w.x-EXC.x,w.z-EXC.z)));const tp=C.truckPos(sim.t);
  const toe=Math.hypot(Math.max(-14-EXC.x,0,EXC.x-10),Math.max(0,Math.abs(EXC.z)-14));
  const rel=[`バックホウ ─ 盛土法尻：${fmt(toe,1)} m`,`バックホウ ─ 最寄り作業員：${fmt(wmin,1)} m`,`ダンプ ─ バックホウ：${fmt(Math.hypot(tp.x-EXC.x,tp.z-EXC.z),1)} m`,`盛土 天端（現況最高）：EL ${fmt(out.emb.bb.max.y,2)} m`,`護岸 延長：${fmt(out.rev.bb.d.z,1)} m（法勾配 約1:1.18）`];
  pane.insertAdjacentHTML('beforeend',`<div class="sec-h" style="margin-top:10px">${icon('link')}空間関係（AIが推論に使用）</div>`+rel.map(r=>`<div class="rel">${r}</div>`).join(''));
  AG.detected=out;return out;
}

/* =========================================================
   Scenarios
   ========================================================= */
const SC={};
SC.asbuilt=async()=>{
  await phase('perceive');
  await say('perceive','まず現在のビューポートを撮影し、3DGSシーングラフ（物体ラベル・3D BBox・座標）を取得して現場を把握します。');
  await clickView('all','視点：全体');await screenshot();
  const sg=await fnTool('get_scene_graph',{source:'3dgs_viewport',include:['semantic_label','bbox_3d','relations'],anonymize_persons:true},async()=>{const o=await detectScene();return{objects:Object.keys(o).length,splats:N,coordinate_system:'現場座標(m), Y=標高',persons:'匿名ID W-01〜W-03（外見情報なし）'}});
  await dragView(150);
  const e=AG.detected.emb.bb;
  await say('perceive',`盛土（約${fmt(e.d.x,0)}m×${fmt(e.d.z,0)}m、天端EL約${fmt(e.max.y,1)}m）、切土対象の地山、護岸、河川、バックホウ、ダンプ、作業員3名を認識しました。作業員は匿名IDと位置のみで扱います。`);
  await phase('reason');
  await say('reason','出来形の判定には設計面との比較が必要です。①設計面レイヤを表示 → ②出来形ヒートマップで面的に偏差を把握 → ③最大不足箇所の横断を確認 → ④規格値で統計判定 → ⑤所見を注記して帳票化、の順に進めます。');
  await phase('act');
  await clickView('emb','視点：盛土');
  await ensureLayer('design',true,'レイヤ：設計面 ON');await wait(500);
  await ensureToggle(true,'出来形ヒートマップ ON');await wait(300);
  await screenshot('ヒートマップを視覚確認');
  const s=await fnTool('compute_deviation',{target:'embankment',reference:'design_surface',tolerance_m:0.2,method:'splat_vs_design_TIN'},async()=>devStats(0.2));
  await say('reason',`偏差：平均 ${s.mean>=0?'+':''}${fmt(s.mean,3)} m、標準偏差 ${fmt(s.std,3)} m、最大不足 ${fmt(s.min)} m、最大過剰 +${fmt(s.max)} m。規格外は ${s.out_under+s.out_over} 点です。最大不足箇所の横断を確認します。`);
  await ensureTool('section','ツール：断面');await click3D(s.worstP,{},'最大不足箇所で横断表示');await wait(1300);
  await ensureTool('annotate','ツール：注記');
  await click3D(s.worstP,{label:`最大不足 ${fmt(s.min)}m（追加盛土・再転圧）`,color:'#ff5d6c',icon:'alert'},'注記：最大不足');
  await click3D(s.maxP,{label:`最大過剰 +${fmt(s.max)}m（敷均し調整）`,color:'#ffb547',icon:'alert'},'注記：最大過剰');
  await ensureTool('select','ツール：視点');
  await phase('verify');await screenshot('結果を視覚検証');
  const pass=s.pass_rate>=95;const verdict=pass?'合格':'是正要（不足部の手直し後に再計測）';
  await say('verify',`判定：規格値±0.20m（サンプル設定）に対する合格率は ${fmt(s.pass_rate,1)}%（${s.n}点中 ${s.n-s.out_under-s.out_over}点）。不足側 ${s.out_under}点・過剰側 ${s.out_over}点。サンプル基準（95%以上）により「${verdict}」と判断します。帳票ドラフトを作成し、確定前に承認を依頼します。`);
  const img=capture(true);
  const ap=await approve({title:'出来形管理帳票（ドラフト）を確定し、レポートに登録',desc:'AIが3DGS点群と設計面の差分から作成した出来形判定です。確定すると業務レポートに登録されます（外部送信は行いません）。',risk:'中（発注者提出書類の基礎資料）',
    kv:[['対象','盛土（施工中）'],['評価点数',s.n+' 点'],['合格率',fmt(s.pass_rate,1)+' %'],['最大不足／過剰',`${fmt(s.min)} m ／ +${fmt(s.max)} m`],['AI判定',verdict]],img});
  if(!ap.ok){await say('verify','承認されなかったため、帳票は確定せずドラフトのまま保持します。指摘があれば指示してください。');return}
  addReport({type:'asbuilt',title:'盛土 出来形管理（面管理）',icon:'heat',color:'#38e1ff',verdict:pass?['ok','合格']:['ng','是正要'],
    kv:[['評価方式','3DGS点群 × 設計面 差分（面管理）'],['評価点数',s.n+' 点'],['平均偏差',fmt(s.mean,3)+' m'],['標準偏差',fmt(s.std,3)+' m'],['最大不足',fmt(s.min)+' m'],['最大過剰','+'+fmt(s.max)+' m'],['規格値（サンプル）','±0.20 m'],['合格率',fmt(s.pass_rate,1)+' %'],['規格外（不足／過剰）',`${s.out_under} ／ ${s.out_over} 点`]],
    findings:`盛土天端の一部（北側中央付近）に最大 ${fmt(s.min)}m の不足が面的に分布。追加盛土・再転圧後に再計測を推奨。南側に +${fmt(s.max)}m の過剰があり敷均しで調整可能。`,snapshot:img,approval:ap});
  await clickEl('#btnReport','レポートを開く');
};
SC.earthwork=async()=>{
  await phase('perceive');
  await say('perceive','土量計算の対象を確認します。スクリーンショットとシーングラフから、切土対象の地山と盛土の位置・規模を把握します。');
  await clickView('all','視点：全体');await screenshot();
  if(!AG.detected)await fnTool('get_scene_graph',{source:'3dgs_viewport',include:['semantic_label','bbox_3d']},async()=>{const o=await detectScene();return{objects:Object.keys(o).length}});
  const h=AG.detected.hill.bb;
  await say('perceive',`切土対象の地山は中心(${fmt(h.c.x,1)}, ${fmt(h.c.z,1)})付近、最高EL約${fmt(h.max.y,1)}m。盛土は設計に対して不足部が残っています。`);
  await phase('reason');
  await say('reason','①切土範囲を多角形で囲み、基準高±0mより上の体積をグリッド積分 → ②盛土の設計面と現況の差から必要盛土量を算出 → ③土量変化率を考慮して運搬台数を試算、の順で土量バランスを確認します。');
  await phase('act');
  await clickView('cut','視点：切土');await ensureTool('volume','ツール：土量');
  const poly=[];for(let k=0;k<6;k++){const a=k/6*Math.PI*2+0.3;const x=-32+Math.cos(a)*10.5,z=6+Math.sin(a)*10.5;poly.push({x,y:T.H(x,z)+0.1,z})}
  for(let k=0;k<poly.length;k++)await click3D(poly[k],{},`範囲頂点 P${k+1}`);
  await clickEl('#polyDone','範囲を確定');
  const v=await fnTool('read_measurement',{panel:'results',item:'latest_volume'},async()=>({cut_m3:TOOL.last.cut,fill_m3:TOOL.last.fill,area_m2:TOOL.last.area,base_level_m:0,grid_m:0.5}));
  await ensureTool('select','ツール：視点');await clickView('emb','視点：盛土');
  const b=await fnTool('compute_fill_requirement',{target:'embankment',reference:'design_surface',grid_m:0.5},async()=>{const e=embBalance();return{design_volume_m3:e.design,current_volume_m3:e.current,shortage_m3:e.under,surplus_m3:e.over,net_required_m3:e.under-e.over}});
  const need=Math.max(0,b.under!==undefined?b.under-b.over:b.shortage_m3-b.surplus_m3);
  const Cf=0.9,Lf=1.25,cap=6.0;
  const hp=await fnTool('plan_haulage',{cut_bank_m3:v.cut_m3,fill_required_m3:need,compaction_C:Cf,loosening_L:Lf,truck_capacity_m3:cap},async()=>{const bank=need/Cf,loose=bank*Lf;const sur=v.cut_m3-bank;return{bank_needed_m3:bank,loose_haul_m3:loose,truck_trips:Math.ceil(loose/cap),surplus_bank_m3:sur,haul_out_loose_m3:sur*Lf,haul_out_trips:Math.ceil(sur*Lf/cap)}});
  addOv({type:'line',a:{x:-30,y:T.H(-30,4)+2,z:4},b:{x:-6,y:5.5,z:0},color:'#ff8a3a',kind:'meas',label:`${icon('truck')}<span>運搬計画 ${hp.truck_trips}台（ほぐし ${fmt(hp.loose_haul_m3,0)}m³）</span>`});
  await phase('verify');await clickView('all','視点：全体');await screenshot('結果を視覚検証');
  await say('verify',`切土量 ${fmt(v.cut_m3,0)} m³（地山）に対し、盛土の必要量は ${fmt(need,1)} m³（締固め後）。C=${Cf}・L=${Lf}（サンプル値）で地山換算 ${fmt(hp.bank_needed_m3,1)} m³、運搬土量 ${fmt(hp.loose_haul_m3,1)} m³、${cap}m³積みで ${hp.truck_trips} 台。残る地山 ${fmt(hp.surplus_bank_m3,0)} m³ は余剰で、場外搬出する場合はほぐし ${fmt(hp.haul_out_loose_m3,0)} m³・延べ ${hp.haul_out_trips} 台が必要です。流用先を含む土量配分計画を推奨します。`);
  const img=capture(true);
  const ap=await approve({title:'土量計算・運搬計画を確定し、レポートに登録',desc:'3DGS地形モデルからAIが算出した土量と運搬台数の試算です。土量変化率・積載量はサンプル値です。',risk:'中（工程・原価計画に影響）',
    kv:[['切土量（地山）',fmt(v.cut_m3,0)+' m³'],['盛土必要量',fmt(need,1)+' m³'],['運搬土量（ほぐし）',fmt(hp.loose_haul_m3,1)+' m³'],['ダンプ台数（盛土へ）',hp.truck_trips+' 台'],['余剰地山の場外搬出',hp.haul_out_trips+' 台（延べ）']],img});
  if(!ap.ok){await say('verify','承認されなかったため、計算結果はドラフトのまま保持します。');return}
  addReport({type:'earthwork',title:'土量計算・運搬計画',icon:'volume',color:'#ffb547',verdict:['wa','要配分計画'],
    kv:[['切土範囲面積',fmt(v.area_m2,0)+' m²'],['切土量（地山）',fmt(v.cut_m3,0)+' m³'],['盛土 設計体積',fmt(b.design_volume_m3,0)+' m³'],['盛土 現況体積',fmt(b.current_volume_m3,0)+' m³'],['不足／過剰',`${fmt(b.shortage_m3,1)} ／ ${fmt(b.surplus_m3,1)} m³`],['盛土必要量（締固め後）',fmt(need,1)+' m³'],['変化率 C／L（サンプル）',`${Cf} ／ ${Lf}`],['運搬土量（ほぐし）',fmt(hp.loose_haul_m3,1)+' m³'],['ダンプ台数（'+cap+'m³積）',hp.truck_trips+' 台'],['残地山（余剰）',fmt(hp.surplus_bank_m3,0)+' m³'],['場外搬出（仮定）',`ほぐし ${fmt(hp.haul_out_loose_m3,0)} m³ ／ 延べ ${hp.haul_out_trips} 台`]],
    findings:`盛土の不足分は切土で十分賄える。切土の大部分は余剰となるため、場外搬出または他工区への流用を含む土量配分計画を作成すること。`,snapshot:img,approval:ap});
  await clickEl('#btnReport','レポートを開く');
};
SC.safety=async()=>{
  await phase('perceive');
  await say('perceive','重機と作業員の位置関係を確認します。人物は匿名化した状態でのみ追跡します。');
  if(!ST.privacy){await say('reason','ポリシー上、人物の匿名化が必要です。匿名化を有効化してから進めます。');await clickEl('#privToggle','人物の自動匿名化 ON')}
  await clickView('exc','視点：重機');await screenshot();
  const tr=await fnTool('track_objects',{classes:['excavator','worker'],anonymize_persons:true,retain_appearance:false},async()=>{
    ST.hi.set(G.EXC_U,[1,.9,.3]);ST.hi.set(G.EXC_B,[1,.9,.3]);
    const ws=workerState.map((w,k)=>({id:'W-0'+(k+1),x:w.x,z:w.z,dist_to_excavator_m:Math.hypot(w.x-EXC.x,w.z-EXC.z)}));
    clearOv('det');addOv({type:'bbox',groups:[G.EXC_B,G.EXC_U],color:'#f2b72a',kind:'det',label:`${icon('exc')}<span>バックホウ（旋回中）</span><em>98%</em>`});
    [G.W1,G.W2,G.W3].forEach((g,k)=>addOv({type:'bbox',groups:[g],color:'#b39bff',kind:'det',pad:4,label:`${icon('worker')}<span>W-0${k+1}</span><em>匿名</em>`}));
    return{excavator:{x:EXC.x,z:EXC.z,state:'swinging'},workers:ws}});
  await phase('reason');
  await say('reason','危険エリアの半径は「旋回中心〜バケット先端の水平距離＋余裕1.0m」とします。まず距離ツールで作業半径を実測します。');
  await phase('act');
  await ensureTool('distance','ツール：距離');
  await click3D({x:EXC.x,y:EXC.y+1.0,z:EXC.z},{color:'#f2b72a'},'旋回中心をクリック');
  const bw=C.bucketWorld();const reach=await click3D(bw,{color:'#f2b72a',label:'作業半径'},'バケット先端をクリック');
  const R=Math.ceil(((reach?reach.dh:6.4)+1.0)*10)/10;
  await say('reason',`作業半径（水平）は ${fmt(reach?reach.dh:6.4)} m。余裕1.0mを加え、危険エリア半径を ${fmt(R,1)} m に設定します。`);
  await ensureTool('hazard','ツール：危険域');
  let intr=false;const ring=await click3D({x:EXC.x,y:EXC.y,z:EXC.z},{radius:R,colorFn:()=>intr?'#ff3d52':(sim.excPaused?'#ffb547':'#ff5d6c')},'旋回中心に危険エリア設定');
  await ensureTool('select','ツール：視点');
  const links=[];
  const res=await fnTool('monitor_clearance',{zone_id:'HZ-01',radius_m:R,targets:['W-01','W-02','W-03'],interval_ms:500,stop_on:'intrusion'},async()=>{
    [0,1,2].forEach(k=>{const dd=()=>Math.hypot(workerState[k].x-EXC.x,workerState[k].z-EXC.z);
      links.push(addOv({type:'link',a:()=>({x:EXC.x,y:EXC.y+1.2,z:EXC.z}),b:()=>({x:workerState[k].x,y:workerState[k].y+1.0,z:workerState[k].z}),color:'#3ee07f',kind:'link',colorFn:()=>dd()<R?'#ff3d52':dd()<R+3?'#ffb547':'#3ee07f',label:'',labelFn:()=>`${icon('worker')}<span>W-0${k+1}　${fmt(dd(),1)} m</span>`}))});
    const t0=performance.now();let minD=1e9,minW='',events=[];let realT=0;
    while(true){await wait(250);realT+=250;const ds=workerState.map(w=>Math.hypot(w.x-EXC.x,w.z-EXC.z));ds.forEach((d,k)=>{if(d<minD){minD=d;minW='W-0'+(k+1)}});
      const k=ds.findIndex(d=>d<R);if(k>=0&&!intr){intr=true;events.push({t:nowStr(),worker:'W-0'+(k+1),distance_m:ds[k]});toast(`侵入検知：W-0${k+1} が危険エリア内（${fmt(ds[k],1)} m）`,'hazard','#ff3d52',5000);SAS.emit('alert',{worker:'W-0'+(k+1),d:ds[k]});SAS.emit('notify',{ic:'hazard',c:'#ff5d6c',title:`危険エリア侵入：W-0${k+1}（匿名）`,body:`現場A HZ-01（R=${fmt(R,1)}m）内 ${fmt(ds[k],1)}m。旋回一時停止の判断をお願いします。`,act:'viewer'});audit('SYSTEM','ALERT',`HZ-01 侵入 W-0${k+1} ${fmt(ds[k],1)}m`);}
      if(intr&&realT>1500)break;if((performance.now()-t0)>40000)break}
    return{monitored_s:(performance.now()-t0)/1000,intrusion:intr,events,min_distance_m:minD,min_worker:minW}});
  await phase('verify');await screenshot('状況を視覚検証');
  await say('verify',res.intrusion?`危険エリア（R=${fmt(R,1)}m）への侵入を検知しました（${res.events[0].worker}、${fmt(res.events[0].distance_m,1)} m）。最小離隔は ${fmt(res.min_distance_m,1)} m。旋回の一時停止を推奨します。重機の停止指示は人の判断が必要なため承認を依頼します。`:`監視時間内に侵入はありませんでした。最小離隔 ${fmt(res.min_distance_m,1)} m。`);
  const img=capture(true);
  const ap=await approve({title:'重機オペレーターへ「旋回一時停止」アラートを送信',desc:'デモでは画面内の重機アニメーション停止と通知のみを行います。実運用では現場の無線・警報装置連携を想定し、最終判断は必ず人が行います。',risk:'高（作業停止を伴う）',
    kv:[['危険エリア','HZ-01 半径 '+fmt(R,1)+' m'],['侵入','あり：'+(res.events[0]?res.events[0].worker:'-')],['最小離隔',fmt(res.min_distance_m,1)+' m'],['人物情報','匿名ID・位置のみ（外見情報なし）']],img});
  if(ap.ok){sim.excPaused=true;intr=false;toast('バックホウ：旋回一時停止（デモ）','exc','#ffb547',4500);await say('verify','アラートを送信し、旋回を一時停止しました。作業員の退避確認後、オペレーターの判断で再開してください。')}
  else await say('verify','承認されなかったため、アラートは送信しません。監視は継続可能です。');
  addReport({type:'safety',title:'重機 安全離隔チェック',icon:'hazard',color:'#ff5d6c',verdict:res.intrusion?['ng','侵入あり']:['ok','侵入なし'],
    kv:[['危険エリア','HZ-01（旋回中心）'],['作業半径（実測）',fmt(reach?reach.dh:6.4)+' m'],['設定半径',fmt(R,1)+' m'],['監視時間',fmt(res.monitored_s,1)+' s'],['侵入イベント',res.events.map(e=>`${e.worker} ${fmt(e.distance_m,1)}m`).join(', ')||'なし'],['最小離隔',`${fmt(res.min_distance_m,1)} m（${res.min_worker}）`],['アラート送信',ap.ok?'送信（旋回一時停止）':'未送信']],
    findings:'旋回範囲内への立入りが発生。立入禁止柵・誘導員の配置、合図者との連携手順の再周知を推奨。人物は匿名化して扱い、個人の評価・監視には使用しない。',snapshot:img,approval:ap});
};
SC.inspect=async()=>{
  await phase('perceive');
  await say('perceive','護岸の変状点検を行います。護岸正面へ視点を移動し、近接して点群をスキャンします。');
  await clickView('rev','視点：護岸');await scrollView(1,'近接ズーム');await screenshot();
  ST.scan={axis:'z',pos:-14};const sf=$('#scanframe');sf.classList.add('on');await animate(2400,p=>{ST.scan.pos=-14+p*34});ST.scan=null;sf.classList.remove('on');
  const df=await fnTool('detect_defects',{target:'revetment',classes:['crack','spalling','joint_gap'],min_length_m:0.3},async()=>{
    ST.crackHi=true;clearOv('det');
    for(const c of CRACKS){addOv({type:'bbox',range:[c.s,c.e],color:'#ff5d6c',kind:'det',pad:10,label:`${icon('crack')}<span>${c.id} ひび割れ</span><em>${(0.86+c.len*0.03).toFixed(2)}</em>`});await wait(250)}
    return{detections:CRACKS.map(c=>({id:c.id,class:'crack',start:c.pts[0],end:c.pts[c.pts.length-1],polyline_length_m:c.len}))}});
  await phase('reason');
  await say('reason',`ひび割れを ${CRACKS.length} 件検出しました。各ひび割れの端点間を距離ツールで実測し、折れ線延長と合わせて判定区分（サンプル基準：1.5m未満Ⅰ／2.5m未満Ⅱ／以上Ⅲ）を付与します。`);
  await phase('act');await ensureTool('distance','ツール：距離');
  const rows=[];
  for(const c of CRACKS){const a=c.pts[0],b=c.pts[c.pts.length-1];await click3D(a,{color:'#ff7ad9'},`${c.id} 始点`);const m=await click3D(b,{color:'#ff7ad9',label:c.id+' 端点間'},`${c.id} 終点`);rows.push({c,m})}
  await ensureTool('annotate','ツール：注記');
  for(const {c} of rows){const cls=c.len<1.5?'Ⅰ 経過観察':c.len<2.5?'Ⅱ 予防保全':'Ⅲ 早期措置';c.cls=cls;const mid=c.pts[Math.floor(c.pts.length/2)];
    await click3D({x:mid.x+0.05,y:mid.y+0.15,z:mid.z},{label:`${c.id} 延長${fmt(c.len)}m 判定${cls}`,color:cls.startsWith('Ⅲ')?'#ff5d6c':cls.startsWith('Ⅱ')?'#ffb547':'#3ee07f',icon:'crack'},`${c.id} 判定を注記`)}
  await ensureTool('select','ツール：視点');
  await phase('verify');await screenshot('結果を視覚検証');
  await say('verify',`判定：${rows.map(r=>`${r.c.id}＝${r.c.cls}（延長${fmt(r.c.len)}m）`).join('、')}。なお、ひび割れ幅は3DGSの解像度では確定できないため、Ⅲ判定箇所はクラックスケールによる近接目視での確認を推奨します。`);
  const img=capture(true);
  const ap=await approve({title:'護岸 点検調書（ドラフト）をレポートに登録',desc:'3DGS点群からAIが検出・計測した変状一覧です。幅の計測は近接目視で補完が必要です。',risk:'中（維持管理計画の基礎資料）',
    kv:rows.map(r=>[r.c.id,`延長 ${fmt(r.c.len)}m ／ 端点間 ${fmt(r.m?r.m.d:0)}m ／ ${r.c.cls}`]),img});
  if(!ap.ok){await say('verify','承認されなかったため、点検調書はドラフトのまま保持します。');return}
  addReport({type:'inspect',title:'護岸 変状点検（ひび割れ）',icon:'crack',color:'#8b7bff',verdict:rows.some(r=>r.c.cls.startsWith('Ⅲ'))?['ng','早期措置あり']:['ok','経過観察'],
    kv:rows.flatMap(r=>[[`${r.c.id} 延長（折れ線）`,fmt(r.c.len)+' m'],[`${r.c.id} 端点間距離`,fmt(r.m?r.m.d:0)+' m'],[`${r.c.id} 判定区分`,r.c.cls]]),
    findings:'Ⅲ判定箇所は早期に近接目視・幅計測を実施し、補修工法（注入・充填等）を検討すること。判定区分は本サンプルの仮基準であり、実業務では各管理者の点検要領に従う。',snapshot:img,approval:ap});
  await clickEl('#btnReport','レポートを開く');
};

/* ---------- runner ---------- */
const SC_NAME={asbuilt:'盛土 出来形管理',earthwork:'土量計算・運搬計画',safety:'重機 安全離隔チェック',inspect:'護岸 変状点検'};
async function runScenario(key,userText){
  if(AG.running){toast('エージェントは実行中です','info','#ffb547');return}
  if(document.body.dataset.page!=='viewer'){SAS.goto('viewer');await new Promise(r=>setTimeout(r,500))}
  Object.assign(AG,{running:true,paused:false,abort:false,steps:0,acts:0,tools:0,tok:0,t0:performance.now(),task:key});
  $('#timeline').innerHTML='';$('#p-tool').innerHTML='';metrics();
  $$('.task').forEach(t=>t.classList.toggle('running',t.dataset.sc===key));
  $('#agState').className='st run';$('#agState').innerHTML='<i></i>実行中：'+SC_NAME[key];$('#loop').classList.add('run');
  vp.classList.add('autopilot');$('#banner').classList.add('show');cursorStyle();const r=vp.getBoundingClientRect();setCur(r.left+r.width/2,r.top+r.height/2);curEl.classList.add('show');
  $('#cPause').disabled=false;$('#cStop').disabled=false;$$('#tabs button')[0].click();
  bubble('user',null,null,esc(userText||SC_NAME[key]+'をお願いします'));audit('HUMAN','TASK',userText||SC_NAME[key]);con(`タスク開始：${SC_NAME[key]}（${MNAME[whoFor('reason')]}）`);
  let ok=false;SAS.emit('task',{key,state:'start'});
  try{if(C.VER.idx!==C.VER.list.length-1){await phase('perceive');await say('perceive',`表示中の3DGS版（${C.VER.list[C.VER.idx].d}）が最新ではありません。最新版（${C.VER.list[C.VER.list.length-1].d}）に切り替えてから作業します。`);await clickEl('#verBar .vchip:last-of-type','4D：最新版に切替');await wait(400)}
    await SC[key]();ok=true;$(`.task[data-sc="${key}"]`).classList.add('done');tlAdd('verify','完了','checkc');toast(`タスク完了：${SC_NAME[key]}`,'checkc','#3ee07f')}
  catch(e){if(e instanceof Abort){bubble('ai',whoFor('verify'),null,'ユーザー操作により停止しました。途中までの計測結果は保持しています。');tlAdd('verify','停止','stop');audit('HUMAN','STOP',SC_NAME[key])}
    else{console.error(e);bubble('ai',whoFor('verify'),null,'エラーが発生したため中断しました：'+esc(e.message));toast('エラー：'+e.message,'alert','#ff5d6c')}}
  finally{AG.running=false;AG.paused=false;AG.abort=false;$$('.task').forEach(t=>t.classList.remove('running'));$('#agState').className='st';$('#agState').innerHTML='<i></i>待機中';$('#loop').classList.remove('run');$$('#loop .node').forEach(n=>n.classList.remove('on'));
    vp.classList.remove('autopilot');$('#banner').classList.remove('show');curEl.classList.remove('show');$('#cPause').disabled=true;$('#cStop').disabled=true;$('#cPause').innerHTML=icon('pause');ST.hi.clear();if(TOOL.cur!=='select')setTool('select');
    audit('SYSTEM','TASK_END',`${SC_NAME[key]} ${ok?'完了':'中断'} steps=${AG.steps} actions=${AG.acts} tools=${AG.tools}`);SAS.emit('task',{key,state:ok?'done':'stop',tok:AG.tok});if(ok)SAS.emit('notify',{ic:'checkc',c:'#3ee07f',title:`AIタスク完了：${SC_NAME[key]}`,body:`${MNAME[whoFor('reason')]}・UI操作${AG.acts}回／ツール${AG.tools}回。結果はレポートに登録されています。`,act:'report'});con(`タスク${ok?'完了':'終了'}：${SC_NAME[key]}`)}
}
$$('.task').forEach(t=>t.addEventListener('click',()=>runScenario(t.dataset.sc)));
function route(s){if(/出来形|ヒート|設計面|偏差|仕上/.test(s))return'asbuilt';if(/土量|体積|切土|運搬|残土|土工/.test(s))return'earthwork';if(/安全|離隔|危険|重機|旋回|作業員|ヒヤリ|バックホウ/.test(s))return'safety';if(/護岸|ひび|亀裂|点検|変状|クラック/.test(s))return'inspect';if(/盛土/.test(s))return'asbuilt';return null}
function ask(){const tx=$('#askTx').value.trim();if(!tx)return;$('#askTx').value='';const k=route(tx);
  if(!k){bubble('user',null,null,esc(tx));bubble('ai',whoFor('reason'),'reason','（オフライン版）この指示は対応業務に分類できませんでした。対応できるのは「出来形管理」「土量計算・運搬計画」「重機の安全離隔」「護岸の変状点検」です。例：「盛土の出来形をチェックして」');return}
  runScenario(k,tx)}
$('#askBtn').addEventListener('click',ask);$('#askTx').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask()}});
$('#cPause').addEventListener('click',()=>{if(!AG.running)return;AG.paused=!AG.paused;$('#cPause').innerHTML=icon(AG.paused?'play':'pause');$('#agState').innerHTML='<i></i>'+(AG.paused?'一時停止中':'実行中：'+SC_NAME[AG.task]);$('#loop').classList.toggle('run',!AG.paused);if(AG.paused)$('#bannerTx').textContent='一時停止中（人が操作できます）';audit('HUMAN',AG.paused?'PAUSE':'RESUME',SC_NAME[AG.task])});
$('#cStop').addEventListener('click',()=>{if(!AG.running)return;AG.abort=true;AG.paused=false;if(AG.approveRes)AG.approveRes(false)});
$$('#spd button').forEach(b=>b.addEventListener('click',()=>{AG.speed=+b.dataset.s;$$('#spd button').forEach(x=>x.classList.toggle('on',x===b))}));
$('#hitlSw').addEventListener('click',e=>{AG.hitl=!AG.hitl;e.currentTarget.classList.toggle('on',AG.hitl);audit('HUMAN','CONFIG','人間承認 '+(AG.hitl?'ON':'OFF（デモ）'));if(!AG.hitl)toast('人間承認をOFFにしました（デモ用）。本番では確定・提出・停止指示は必ず人が承認してください。','shield','#ffb547',5200)});
$$('#tabs button').forEach(b=>b.addEventListener('click',()=>{$$('#tabs button').forEach(x=>x.classList.toggle('on',x===b));$$('.pane').forEach(p=>p.classList.toggle('on',p.id==='p-'+b.dataset.p))}));
document.addEventListener('keydown',e=>{if(e.target.tagName==='TEXTAREA')return;if(e.code==='Space'&&AG.running){e.preventDefault();$('#cPause').click()}
  if(e.key==='Escape'){if($('.modal.show:not(#mApprove)')){$$('.modal.show').forEach(m=>{if(m.id!=='mApprove')m.classList.remove('show')})}else if(TOOL.cur!=='select')setTool('select')}});

/* =========================================================
   Report / API / Architecture modals
   ========================================================= */
function reportHTML(forExport){
  if(!REP.length)return`<div class="empty" style="text-align:center;padding:30px">${icon('report','i xl')}<br><br>まだ登録されたレポートはありません。<br>右パネルのタスクをAIエージェントに実行させ、承認すると登録されます。</div>`;
  const head=`<div class="rcard" style="background:linear-gradient(160deg,rgba(56,225,255,.08),rgba(139,123,255,.06))"><h4>${icon('office')}${esc(window.__SAS_SITE_NAME__||'○○川 築堤・護岸工事（サンプル現場）')}</h4><table><tr><td>作成</td><td>${new Date().toLocaleString('ja-JP')}</td></tr><tr><td>作成者</td><td>空間AIエージェント（${esc(MODEL_INFO[AG.model])}）</td></tr><tr><td>登録件数</td><td>${REP.length} 件</td></tr><tr><td>監査ログ</td><td>${AUD.length} 件 ／ 最終ハッシュ ${prevHash}</td></tr></table></div>`;
  return head+REP.map(r=>`<div class="rcard"><h4 style="color:${r.color}">${icon(r.icon)}<span style="color:var(--tx)">${r.id}　${esc(r.title)}</span><span class="vd ${r.verdict[0]}">${esc(r.verdict[1])}</span></h4><table>${r.kv.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
    <div style="margin-top:8px;font-size:12px;line-height:1.7;color:var(--tx2)"><b style="color:var(--tx)">AI所見：</b>${esc(r.findings)}</div>${r.snapshot?`<img src="${r.snapshot}" alt="snapshot">`:''}
    <div class="rmeta">承認：${esc(r.approval.by)} ／ ${new Date(r.approval.at).toLocaleString('ja-JP')} ／ モデル：${r.model}</div></div>`).join('')+
    `<div class="note">本レポートはAIが作成したドラフトです。数値は3DGSモデル（サンプル）からの算出値であり、規格値・判定基準・土量変化率等はサンプル設定です。実業務では発注者基準・社内基準に従い、責任者が確認してください。</div>`;
}
function openReport(){$('#repBody').innerHTML=reportHTML();$('#mReport').classList.add('show')}
$('#btnReport').addEventListener('click',openReport);
function dl(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
$('#repHtml').addEventListener('click',()=>{const css=[...document.querySelectorAll('style')].map(s=>s.textContent).join('\n');const sym=document.querySelector('svg defs').outerHTML;
  const html=`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>AI業務レポート ${new Date().toLocaleDateString('ja-JP')}</title><style>${css}html,body{overflow:auto;height:auto}body{padding:24px;max-width:900px;margin:0 auto}</style></head><body><svg width="0" height="0" style="position:absolute">${sym}</svg><h2 style="margin-bottom:14px">AI作成 業務レポート（ドラフト）</h2>${reportHTML(true)}<h3 style="margin:18px 0 8px">監査ログ</h3><pre class="code">${esc(JSON.stringify(AUD,null,1))}</pre></body></html>`;
  dl(`AI業務レポート_${Date.now()}.html`,new Blob([html],{type:'text/html'}));audit('HUMAN','EXPORT','レポートHTML保存')});
$('#repJson').addEventListener('click',()=>{dl(`AI業務レポート_${Date.now()}.json`,new Blob([JSON.stringify({site:'○○川 築堤・護岸工事（サンプル）',generated:new Date().toISOString(),reports:REP.map(r=>({...r,snapshot:r.snapshot?'(jpeg dataURL 省略)':null})),audit:AUD},null,2)],{type:'application/json'}));audit('HUMAN','EXPORT','レポートJSON保存')});
$('#audExport').addEventListener('click',()=>dl(`監査ログ_${Date.now()}.json`,new Blob([JSON.stringify(AUD,null,2)],{type:'application/json'})));
$$('.modal').forEach(m=>{m.addEventListener('click',e=>{if(e.target===m&&m.id!=='mApprove')m.classList.remove('show')});m.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>m.classList.remove('show')))});

const CODE={
claude:`// サーバ側（社内プロキシ）から呼び出す想定。APIキーはブラウザに置かない。
POST https://api.anthropic.com/v1/messages
x-api-key: $ANTHROPIC_API_KEY
anthropic-version: 2023-06-01
anthropic-beta: computer-use-<最新バージョン>      // ※最新ドキュメントで確認

{
  "model": "claude-opus-5-5",
  "max_tokens": 4096,
  "system": "あなたは土木施工管理の空間AIエージェント。画面と3Dシーングラフから現場を理解し、UIツールを操作して業務を完了する。確定・提出・作業停止は必ず人間承認を求める。人物は匿名IDと位置のみで扱う。",
  "tools": [
    { "type": "computer_<最新バージョン>", "name": "computer",
      "display_width_px": 1440, "display_height_px": 900 },
    { "name": "get_scene_graph",
      "description": "3DGSビューポートの物体ラベル・3D BBox・空間関係を返す",
      "input_schema": { "type": "object", "properties": {
        "include": { "type": "array", "items": { "type": "string" } },
        "anonymize_persons": { "type": "boolean" } } } },
    { "name": "compute_deviation",
      "description": "盛土点群と設計面の偏差統計（平均・最大・合格率）を返す",
      "input_schema": { "type": "object", "properties": {
        "target": { "type": "string" }, "tolerance_m": { "type": "number" } },
        "required": ["target"] } }
  ],
  "messages": [{ "role": "user", "content": [
    { "type": "text", "text": "盛土の出来形をチェックして報告書にまとめて" },
    { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "<viewport screenshot>" } }
  ]}]
}

// 応答の tool_use（例）
{ "type": "tool_use", "name": "computer", "input": { "action": "left_click", "coordinate": [118, 214] } }
→ クライアントで実行し tool_result（スクリーンショット）を返す → 次のターンへ`,
openai:`// サーバ側（社内プロキシ）から呼び出す想定。APIキーはブラウザに置かない。
POST https://api.openai.com/v1/responses
Authorization: Bearer $OPENAI_API_KEY

{
  "model": "<computer use 対応の最新モデル>",          // ※最新ドキュメントで確認
  "tools": [
    { "type": "computer_use_preview",                      // ※ツール型名は最新版を確認
      "display_width": 1440, "display_height": 900, "environment": "browser" },
    { "type": "function", "name": "compute_volume",
      "description": "多角形範囲の切土・盛土体積をグリッド積分で返す",
      "parameters": { "type": "object", "properties": {
        "polygon": { "type": "array", "items": { "type": "object" } },
        "base_level_m": { "type": "number" } }, "required": ["polygon"] } }
  ],
  "input": [{ "role": "user", "content": [
    { "type": "input_text", "text": "切土の土量を計算して運搬台数を出して" },
    { "type": "input_image", "image_url": "data:image/png;base64,<viewport screenshot>" }
  ]}],
  "truncation": "auto"
}

// 応答の computer_call（例）
{ "type": "computer_call", "call_id": "call_…", "action": { "type": "click", "button": "left", "x": 640, "y": 410 } }
→ 実行後 computer_call_output（スクリーンショット）を previous_response_id 付きで返す`,
loop:`// エージェントループ（本サンプルの動作をコード化した擬似コード）
async function agentLoop(task) {
  let ctx = [userMessage(task), await screenshot(), await sceneGraph()];   // 知覚
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await llm.call({ tools: [computer, ...civilTools], input: ctx }); // 推論
    for (const call of res.toolCalls) {
      if (!policy.allows(call)) { audit("DENY", call); continue; }          // 操作ホワイトリスト
      if (policy.needsHuman(call)) {                                        // 確定・提出・停止
        const ok = await humanApproval(call, await screenshot());
        audit(ok ? "APPROVED" : "REJECTED", call);
        if (!ok) { ctx.push(rejected(call)); continue; }
      }
      const out = call.type === "computer" ? await ui.execute(call)         // 操作
                                           : await civilTools[call.name](call.input);
      audit("EXEC", call, hash(out));                                       // ハッシュ連鎖
      ctx.push(result(call, out), await screenshot());                      // 検証→再知覚
    }
    if (res.done) return res.report;
  }
}
// 人物は画素段階で匿名化 → LLMへは匿名ID・座標のみ。外部送信・設計データ改変はポリシーで禁止。`};
function showCode(k){$('#codeBox').textContent=CODE[k];$$('#codeTabs button').forEach(b=>b.classList.toggle('on',b.dataset.c===k))}
$$('#codeTabs button').forEach(b=>b.addEventListener('click',()=>showCode(b.dataset.c)));
$('#btnApi').addEventListener('click',()=>{showCode('claude');$('#mApi').classList.add('show')});
let archBuilt=false;
function buildArch(){if(archBuilt)return;archBuilt=true;const s=$('#archSvg');
  const nodes=[['n1',20,30,170,'3DGS 現場データ','撮影→ガウス粒子','#38e1ff','splat'],['n2',230,30,170,'WebGPU レンダラ','WGSL・インスタンス描画','#8b7bff','gpu'],['n3',440,30,180,'視覚入力','スクショ＋シーングラフ','#38e1ff','eye'],['n4',660,30,180,'LLM（Claude / OpenAI）','空間推論・計画','#f0956a','brain'],
    ['n5',660,150,180,'ツール呼び出し','computer use / function','#ffb547','api'],['n6',440,150,180,'ブラウザUI 自律操作','計測・解析・注記','#ffb547','hand'],['n7',230,150,170,'検証','結果を再撮影して確認','#3ee07f','checkc'],['n8',20,150,170,'人間承認（HITL）','確定・提出・停止','#ff5d6c','shield']];
  let h=`<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#6c7ba4"/></marker></defs>`;
  const P={n1:[190,62],n2:[230,62]};const paths=[['p1','M190 62H230','#38e1ff'],['p2','M400 62H440','#8b7bff'],['p3','M620 62H660','#38e1ff'],['p4','M750 94V150','#f0956a'],['p5','M660 182H620','#ffb547'],['p6','M440 182H400','#ffb547'],['p7','M315 150V120Q315 108 330 108H510Q530 108 530 94','#3ee07f'],['p8','M230 182H190','#ff5d6c']];
  h+=paths.map(([id,d,c])=>`<path id="${id}" d="${d}" stroke="${c}" stroke-width="2" fill="none" class="flowl" marker-end="url(#ah)"/>`).join('');
  h+=`<rect x="230" y="262" width="610" height="46" rx="10" fill="#0f1838" stroke="#6c7ba4" stroke-dasharray="4 4"/><text x="250" y="290" fill="#9fb0d8" font-size="12">監査ログ（ハッシュ連鎖）─ 全ての知覚・推論・操作・承認を記録し、後から検証可能に</text>`;
  h+=[['M105 214V285H230'],['M530 214V262'],['M750 214V262']].map(([d])=>`<path d="${d}" stroke="#6c7ba4" stroke-width="1.3" fill="none" stroke-dasharray="3 4"/>`).join('');
  h+=nodes.map(([id,x,y,w,t1,t2,c,ic])=>`<g class="nd"><rect x="${x}" y="${y}" width="${w}" height="64" rx="12" stroke="${c}" style="filter:drop-shadow(0 0 6px ${c}55)"/><use href="#i-${ic}" x="${x+12}" y="${y+20}" width="24" height="24" stroke="${c}" fill="none" stroke-width="1.8"/><text x="${x+44}" y="${y+28}">${t1}</text><text class="s" x="${x+44}" y="${y+46}">${t2}</text></g>`).join('');
  h+=paths.map(([id,,c],k)=>`<circle r="4.5" fill="${c}" class="pkt" style="color:${c}"><animateMotion dur="${1.6+k*0.15}s" repeatCount="indefinite"><mpath href="#${id}"/></animateMotion></circle>`).join('');
  s.innerHTML=h;}
$('#btnArch').addEventListener('click',()=>{buildArch();$('#mArch').classList.add('show')});

/* =========================================================
   Header sparks, clock, main loop, boot
   ========================================================= */
const sp=$('#sparks');for(let k=0;k<22;k++){const i=document.createElement('i');i.style.left=(Math.random()*100)+'%';i.style.top=(20+Math.random()*60)+'%';i.style.animationDelay=(Math.random()*5)+'s';i.style.background=['#38e1ff','#8b7bff','#ffb547'][k%3];sp.appendChild(i)}
setInterval(()=>{$('#clock').textContent=nowStr()},500);
let lastT=performance.now(),fpsT=0,fpsN=0,mmTick=0;
function frame(now){
  const dt=Math.min(100,now-lastT);lastT=now;const t=now/1000;
  C.tweenStep(dt,AG.running?(AG.paused?0:AG.speed):1);
  if(document.body.dataset.page&&document.body.dataset.page!=='viewer'){requestAnimationFrame(frame);return}
  C.updateDynamic(t,dt);C.projectAll();
  if(C.getRenderer()==='webgpu'&&C.GPU.ok){try{C.drawGPU(t)}catch(e){console.warn(e);C.GPU.ok=false;C.setRenderer('canvas2d')}}
  else{const x=C.ctx2d;x.setTransform(dpr,0,0,dpr,0,0);C.draw2D(x,t,Wc,Hc)}
  updateOverlays(t);if(++mmTick%4===0)drawMinimap(t);
  fpsT+=dt;fpsN++;if(fpsT>500){$('#hFps').textContent=Math.round(fpsN*1000/fpsT);$('#hSpl').textContent=C.getSorted().length.toLocaleString();fpsT=0;fpsN=0}
  requestAnimationFrame(frame);
}
async function boot(){
  const steps=$$('#bootSteps div'),bar=$('#bootBar');const mark=(k,okk=true)=>{steps[k].classList.add('on');if(okk)steps[k].classList.add('ok');bar.style.width=((k+1)/steps.length*100)+'%'};
  const sl=ms=>new Promise(r=>setTimeout(r,ms));
  steps[0].classList.add('on');
  let msg=null;try{msg=await Promise.race([C.initGPU(C.cvGpu),sl(3500).then(()=>'タイムアウト')])}catch(e){msg=String(e&&e.message||e)}
  mark(0);steps[0].lastChild.textContent=C.GPU.ok?`WebGPU 利用可能（${C.GPU.info}）`:`WebGPU 不可 → Canvas2D（${msg}）`;await sl(250);
  C.setRenderer(C.GPU.ok?'webgpu':'canvas2d');requestAnimationFrame(frame);
  steps[1].lastChild.textContent=`3DGS 現場シーンを生成（${N.toLocaleString()} ガウシアン・スプラット）`;mark(1);await sl(380);
  mark(2);await sl(320);updModel();mark(3);await sl(320);audit('SYSTEM','BOOT',`renderer=${C.getRenderer()} splats=${N}`);mark(4);await sl(450);
  $('#boot').classList.add('hide');con(`準備完了 ─ ${C.getRenderer()==='webgpu'?'WebGPU':'Canvas2D'} / ${N.toLocaleString()} splats / オフラインモード`);
  bubble('ai','claude',null,'こんにちは。現場の3DGSモデルを<b>見て</b>理解し、左のUIツールを<b>自分で操作して</b>土木業務を完結させるエージェントです。上の4つのタスクを選ぶか、指示を入力してください。<br><span style="color:var(--tx3);font-size:11px">※完全オフラインのモックです。AIの応答・API呼び出しは模擬で、外部通信は行いません。</span>');
  flyTo(VIEWS.all,10);setRole('agent',true);SAS.emit('ready');
}
window.__SAS_BOOT__=boot;
/* ---------- theme (light / dark) ---------- */
function applyTheme(t,anim,save){const h=document.documentElement;if(anim){h.classList.add('theming');setTimeout(()=>h.classList.remove('theming'),650)}h.dataset.theme=t;
  if(save){try{localStorage.setItem('sas-theme',t)}catch(e){}}const F=C.FOG;if(t==='light'){F[0]=.83;F[1]=.89;F[2]=.98}else{F[0]=.08;F[1]=.14;F[2]=.3}renderMMBase();if(window.SAS&&SAS.emit)SAS.emit('theme',t)}
$('#themeBtn').addEventListener('click',()=>{const t=document.documentElement.dataset.theme==='light'?'dark':'light';applyTheme(t,true,true);con(t==='light'?'ライトモードに切り替えました':'ダークモードに切り替えました')});
applyTheme(document.documentElement.dataset.theme||'dark');
try{matchMedia('(prefers-color-scheme: light)').addEventListener('change',e=>{let s=null;try{s=localStorage.getItem('sas-theme')}catch(_){}if(!s)applyTheme(e.matches?'light':'dark',true)})}catch(e){}
window.__SAS_DEBUG={AG,REP,AUD,runScenario,devStats,embBalance,TOOL,ST};
window.__SAS_APP={AG,REP,AUD,APPROVALS,ROLE,POLICY,setRole,audit,toast,con,runScenario,openReport,reportHTML,fnv,embBalance,devStats,buildVerBar,setVersion,SC_NAME,MODEL_INFO,MNAME,dl,updModel,getPrevHash:()=>prevHash,setPrevHash:h=>{prevHash=h},approve,addReport};
})();

(()=>{
'use strict';
const C=window.__SAS_CORE,A=window.__SAS_APP,SAS=window.SAS;
const {$,$$,icon,fmt,esc,clamp,lerp,ease}=C;
const toast=A.toast;
const ago=m=>new Date(Date.now()-m*60000);
const hm=d=>new Date(d).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
const md=d=>{const x=new Date(d);return `${x.getMonth()+1}/${x.getDate()} ${hm(x)}`};
const yen=v=>'¥'+Math.round(v).toLocaleString('ja-JP');
const S={api:0,blocked:0,tok:0,by:{claude:0,openai:0},log:[],alerts:0,tasks:0,taskTok:0,types:{asbuilt:0,earthwork:0,safety:0,inspect:0},newVer:0};

/* =========================================================
   Notifications (shared by dashboard feed / chat)
   ========================================================= */
const NOTIF=[
  {ic:'drone',c:'#38e1ff',site:'現場A',title:'3DGS生成完了：現場A 11/18版',body:'ドローン撮影 412枚 → 約1.2万スプラット。設計データとの座標合わせ済み。',act:'data',t:ago(1500)},
  {ic:'checkc',c:'#3ee07f',site:'現場D',title:'AI定期チェック：現場D 土量照合',body:'切盛バランスの差 +2.1%（許容内）。下書きを登録しました。',act:'approvals',t:ago(700)},
  {ic:'hazard',c:'#ff5d6c',site:'現場B',title:'危険エリア接近：現場B（匿名 W-07）',body:'クレーン旋回範囲 R=12m に 1.4m まで接近。注意喚起を送信済み。',act:'dash',t:ago(180)},
  {ic:'shield',c:'#ffb547',site:'現場C',title:'承認依頼：現場C 坑口部 変状点検調書',body:'AI下書き（ひび割れ2件・Ⅱ判定）。現場代理人の承認待ち。',act:'approvals',t:ago(60)}];
const LIVE_POOL=[
  {ic:'drone',c:'#38e1ff',site:'現場E',title:'撮影データ受信：現場E',body:'360°カメラ巡回 1,240フレーム。3DGS生成キューに登録しました。'},
  {ic:'eye',c:'#8b7bff',site:'現場B',title:'AI定期チェック：現場B 下部工',body:'橋脚P2の出来形：設計差 ±0.03m 以内（下書き）。'},
  {ic:'hazard',c:'#ffb547',site:'現場D',title:'注意：現場D 法肩付近',body:'重機と匿名作業員の離隔 4.2m（基準5m）。注意喚起のみ。'},
  {ic:'cloud',c:'#ff7ad9',site:'全社',title:'保存先同期完了',body:'本日分のレポート・スナップショット 6件をDirectCloudへ保存しました。'},
  {ic:'checkc',c:'#3ee07f',site:'現場C',title:'3DGS生成完了：現場C 11/20版',body:'坑口部 地上LiDAR＋写真。前回比で掘削進捗 +4.1m。'}];
function notify(n){n.t=n.t||new Date();n.site=n.site||'現場A';NOTIF.push(n);SAS.emit('notif',n)}
SAS.on('notify',n=>notify({...n}));

/* =========================================================
   Navigation, role menu
   ========================================================= */
const PAGES=[['dash','ホーム','home'],['viewer','3Dビュー','cube'],['pipeline','データ取得','drone'],['data','3D基盤','db'],['approvals','承認','shield'],['integration','連携','link'],['governance','統制','lock'],['audit','監査ログ','key'],['settings','システム設定','cog'],['arch','構成','flow'],['roadmap','導入計画','flag']];
let page='viewer';
$('#nav').innerHTML=PAGES.map(([k,n,ic],i)=>([2,4,9].includes(i)?'<div class="sep"></div>':'')+`<button class="nb" data-pg="${k}" title="${n}">${icon(ic,'i')}<span>${n}</span>${k==='approvals'?'<i class="bd" id="apBadge" style="display:none">0</i>':''}</button>`).join('');
$$('#nav .nb').forEach(b=>b.addEventListener('click',()=>goto(b.dataset.pg)));
const allowed=k=>A.ROLE.defs[A.ROLE.cur].pages.includes(k);
function refreshNav(){$$('#nav .nb').forEach(b=>b.classList.toggle('locked',!allowed(b.dataset.pg)))}
const P={};
function goto(k){
  if(A.AG.running&&k!=='viewer'){toast('AIエージェント実行中は「3Dビュー」から移動できません（停止すると移動できます）','lock','#ffb547');return}
  if(!allowed(k)){toast(`「${A.ROLE.defs[A.ROLE.cur].n}」ロールではこの画面を利用できません（Entra IDグループで制御・模擬）`,'lock','#ffb547');return}
  page=k;document.body.dataset.page=k;$$('#nav .nb').forEach(b=>b.classList.toggle('on',b.dataset.pg===k));$$('.page').forEach(p=>p.classList.toggle('on',p.id==='pg-'+k));
  const pg=P[k];if(pg){if(!pg._init){pg.init();pg._init=true}pg.refresh&&pg.refresh()}
}
SAS.goto=goto;
function act(a){if(a==='report'){A.openReport();return}if(a==='approvals'||a==='data'||a==='dash'||a==='viewer')goto(a)}
document.addEventListener('click',e=>{const g=e.target.closest('[data-goto]');if(g)goto(g.dataset.goto)});
const rm=$('#roleMenu');
function buildRoleMenu(){const _allow=window.__SAS_ALLOWED_ROLES__;const _roles=Object.entries(A.ROLE.defs).filter(([k])=>!Array.isArray(_allow)||_allow.includes(k));rm.innerHTML=`<div class="rh">${icon('lock')}Cloudflare Access ─ 付与されたロール</div>`+_roles.map(([k,d])=>`<button class="ritem ${k===A.ROLE.cur?'on':''}" data-r="${k}" style="--c:${d.c}"><span class="ri">${icon(d.ic,'i')}</span><span><b>${d.n}</b><small>${d.grp}${d.approve?' ・ 承認権限あり':''}</small></span><svg class="i sm ok"><use href="#i-checkc"/></svg></button>`).join('');
  rm.querySelectorAll('.ritem').forEach(b=>b.addEventListener('click',()=>{rm.classList.remove('show');if(b.dataset.r!==A.ROLE.cur)A.setRole(b.dataset.r)}))}
$('#roleBtn').addEventListener('click',e=>{e.stopPropagation();buildRoleMenu();const r=$('#roleBtn').getBoundingClientRect();rm.style.left=Math.max(8,r.right-330)+'px';rm.classList.toggle('show')});
document.addEventListener('click',e=>{if(!e.target.closest('#roleMenu'))rm.classList.remove('show')});
SAS.on('role',k=>{refreshNav();if(!allowed(page))goto('dash');else if(P[page]&&P[page]._init&&P[page].refresh)P[page].refresh()});

/* =========================================================
   Shared helpers
   ========================================================= */
function countUp(el,to,dec=0,suffix=''){const t0=performance.now(),from=0;const st=()=>{const p=Math.min(1,(performance.now()-t0)/1100);const v=from+(to-from)*ease(p);el.innerHTML=(dec?v.toFixed(dec):Math.round(v).toLocaleString())+suffix;if(p<1)requestAnimationFrame(st)};st()}
function ring(pct,c,size=62,w=5){const r=size/2-w,L=2*Math.PI*r;return`<svg class="rg" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" style="stroke:var(--line)" stroke-width="${w}"/><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${L*(1-pct)}" style="transition:stroke-dashoffset .4s;filter:drop-shadow(0 0 4px ${c})"/></svg>`}
function gauge(v,c,label,unit='%'){const a0=Math.PI*0.8,a1=Math.PI*2.2,r=42,cx=60,cy=60;const pt=a=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];const[x0,y0]=pt(a0),[x1,y1]=pt(a1);const av=a0+(a1-a0)*clamp(v/100,0,1);const[xv,yv]=pt(av);
  return`<svg viewBox="0 0 120 100"><path d="M${x0} ${y0}A${r} ${r} 0 1 1 ${x1} ${y1}" fill="none" style="stroke:var(--line2)" stroke-width="8" stroke-linecap="round"/><path d="M${x0} ${y0}A${r} ${r} 0 ${av-a0>Math.PI?1:0} 1 ${xv} ${yv}" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round" style="filter:drop-shadow(0 0 5px ${c})"/><text x="60" y="64" text-anchor="middle" fill="#fff" font-size="17" font-family="monospace" font-weight="700">${Math.round(v)}${unit}</text></svg><b>${label}</b>`}
const pending=()=>APS.filter(a=>a.status==='pending').length;
function badge(){const n=pending();const b=$('#apBadge');b.textContent=n;b.style.display=n?'':'none'}

/* =========================================================
   DASHBOARD
   ========================================================= */
const SITES=[{id:'A',n:'○○川 築堤・護岸工事',type:'emb',prog:72,last:'11/18',ai:'出来形 是正要',al:1,c:'#38e1ff',live:true},{id:'B',n:'△△橋 下部工',type:'bridge',prog:45,last:'11/17',ai:'安全 注意1件',al:1,c:'#8b7bff'},{id:'C',n:'□□トンネル 坑口部',type:'tunnel',prog:30,last:'11/16',ai:'点検 承認待ち',al:0,c:'#ffb547'},{id:'D',n:'◇◇団地 造成工事',type:'terrace',prog:88,last:'11/18',ai:'土量 照合済',al:0,c:'#3ee07f'},{id:'E',n:'☆☆ダム 堤体補修',type:'dam',prog:58,last:'11/15',ai:'出来形 下書き',al:0,c:'#ff7ad9'}];
function genSite(type){const pts=[],R=Math.random,P=(x,y,z,c)=>pts.push([x,y,z,c]);
  for(let i=0;i<240;i++){const x=R()*2-1,z=R()*2-1;P(x,0,z,R()<.5?'#6e5b3f':'#5c7a3b')}
  if(type==='emb'){for(let i=0;i<260;i++){const x=R()*1.2-0.75,z=R()*1.3-0.65;const h=0.38*(1-Math.max(Math.abs(x+0.15)/0.6,Math.abs(z)/0.65));if(h>0)P(x,h,z,h>0.3?'#e0be86':'#c49a62')}for(let i=0;i<140;i++)P(0.62+R()*0.35,-0.03,R()*2-1,'#2f7fd6');for(let i=0;i<40;i++)P(0.55+R()*0.05,0.02,R()*2-1,'#aab0b8')}
  if(type==='bridge'){for(const px of [-0.55,0,0.55])for(let y=0;y<0.5;y+=0.03)for(let k=0;k<4;k++)P(px+(R()-.5)*.1,y,(R()-.5)*.14,'#b9c0cc');for(let x=-0.95;x<0.95;x+=0.025)for(const z of [-0.08,0,0.08])P(x,0.52,z,'#e6ebf2');for(let i=0;i<150;i++)P(R()*2-1,-0.03,0.25+R()*0.5,'#2f7fd6')}
  if(type==='tunnel'){for(let i=0;i<420;i++){const x=R()*1.6-1,z=R()*2-1;const h=0.65*Math.exp(-((x+0.25)**2+z*z)/0.35);if(h>0.05&&x<0.42)P(x,h,z,'#4f6d33')}for(let a=0;a<Math.PI;a+=0.06)for(let k=0;k<3;k++)P(0.42,0.28*Math.sin(a),0.3*Math.cos(a)+(R()-.5)*.02,'#c9ced6');for(let i=0;i<40;i++)P(0.43,R()*0.22,(R()-.5)*0.4,'#111622')}
  if(type==='terrace'){for(let i=0;i<420;i++){const x=R()*2-1,z=R()*2-1;const h=x<-0.35?0.34:x<0.15?0.2:0.06;P(x,h,z,h>0.3?'#d6b47c':h>0.15?'#c49a62':'#a9824f')}}
  if(type==='dam'){for(let a=-0.9;a<0.9;a+=0.03)for(let y=0;y<0.55;y+=0.04)P(0.15+0.65*Math.cos(a)-0.65,y,0.75*Math.sin(a),'#c8cdd5');for(let i=0;i<220;i++){const x=-0.5-R()*0.5,z=R()*1.6-0.8;P(x,0.4,z,'#2f7fd6')}}
  return pts}
const thumbs=[];
function drawThumbs(t){for(const th of thumbs){const cv=th.cv,x=cv.getContext('2d');const w=cv.width,h=cv.height;x.clearRect(0,0,w,h);const a=t*0.35+th.o,ca=Math.cos(a),sa=Math.sin(a),cp=Math.cos(.55),sp=Math.sin(.55);
  const pr=th.pts.map(p=>{const xr=p[0]*ca-p[2]*sa,zr=p[0]*sa+p[2]*ca;const yv=p[1]*cp-zr*sp*0.5,dz=p[1]*sp+zr*cp;const s=1.7/(3-dz);return[w/2+xr*s*w*0.42,h*0.6-yv*s*h*0.95,dz,p[3],s]});pr.sort((m,n)=>m[2]-n[2]);
  for(const q of pr){x.globalAlpha=.85;x.fillStyle=q[3];x.beginPath();x.arc(q[0],q[1],2.3*q[4],0,7);x.fill()}x.globalAlpha=1}}
function weekChart(){const vals=[12,15,17.5,21,26,30.5,34,38.5+S.tasks*0.8];const W=360,H=170,L=30,B=24;const mx=Math.max(...vals)*1.15;const bw=(W-L-10)/vals.length;let h='';
  for(let v=0;v<=mx;v+=10){const y=H-B-(v/mx)*(H-B-12);h+=`<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="rgba(140,170,255,.1)"/><text x="${L-6}" y="${y+4}" fill="#6c7ba4" font-size="9" text-anchor="end">${v}</text>`}
  vals.forEach((v,i)=>{const bh=(v/mx)*(H-B-12),x=L+i*bw+5,y=H-B-bh;const last=i===vals.length-1;h+=`<rect class="grow" style="animation-delay:${i*0.07}s" x="${x}" y="${y}" width="${bw-10}" height="${bh}" rx="4" fill="${last?'url(#gW2)':'url(#gW)'}"/><text x="${x+(bw-10)/2}" y="${H-8}" fill="#6c7ba4" font-size="9" text-anchor="middle">${last?'今週':'W'+(i+40)}</text>${last?`<text x="${x+(bw-10)/2}" y="${y-5}" fill="#3ee07f" font-size="10" text-anchor="middle" font-family="monospace">${v.toFixed(1)}</text>`:''}`});
  const pts=vals.map((v,i)=>`${L+i*bw+5+(bw-10)/2},${H-B-(v/mx)*(H-B-12)}`).join(' ');h+=`<polyline class="drawl" points="${pts}" fill="none" stroke="#38e1ff" stroke-width="2" style="filter:drop-shadow(0 0 4px #38e1ff)"/>`;
  $('#chWeek').innerHTML=`<defs><linearGradient id="gW" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b7bff" stop-opacity=".85"/><stop offset="1" stop-color="#8b7bff" stop-opacity=".15"/></linearGradient><linearGradient id="gW2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ee07f"/><stop offset="1" stop-color="#3ee07f" stop-opacity=".2"/></linearGradient></defs>`+h}
function donut(){const d=[['出来形管理',9+S.types.asbuilt,'#38e1ff'],['土量・運搬',6+S.types.earthwork,'#ffb547'],['安全離隔',8+S.types.safety,'#ff5d6c'],['変状点検',4+S.types.inspect,'#8b7bff']];const tot=d.reduce((s,x)=>s+x[1],0);const r=52,L=2*Math.PI*r;let off=0,h='';
  d.forEach(([n,v,c],i)=>{const len=v/tot*L;h+=`<circle cx="70" cy="70" r="${r}" fill="none" stroke="${c}" stroke-width="16" stroke-dasharray="${len-2} ${L}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)" style="filter:drop-shadow(0 0 4px ${c});animation:dnin 1.2s ${i*0.15}s ease-out backwards"/>`;off+=len});
  h+=`<text x="70" y="68" text-anchor="middle" fill="#fff" font-size="22" font-weight="700" font-family="monospace">${tot}</text><text x="70" y="85" text-anchor="middle" fill="#6c7ba4" font-size="10">件（今月）</text>`;
  $('#chDonut').innerHTML=`<style>@keyframes dnin{from{stroke-dasharray:0 ${L}}}</style>`+h;$('#donutLeg').innerHTML=d.map(([n,v,c])=>`<div><i style="background:${c};box-shadow:0 0 6px ${c}"></i>${n}<b>${v}</b></div>`).join('')}
function feedItem(n){return`<div class="fi" style="--c:${n.c}"><span class="fic">${icon(n.ic)}</span><div><b style="font-weight:600">${esc(n.title)}</b><small>${esc(n.site)} ・ ${md(n.t)}</small></div></div>`}
P.dash={init(){
  $('#pg-dash').innerHTML=`<div class="pg-h" style="--c:#38e1ff"><div class="pi">${icon('home','i lg')}</div><div><h2 id="dashHello">ホーム</h2><p>全現場の「撮影 → 3DGS → AIチェック → 承認」を横断表示します（サンプルデータ＋このセッションの実行結果）。</p></div><div class="act"><button class="hbtn" data-goto="viewer">${icon('cube')}現場Aを3Dで開く</button><button class="hbtn" data-goto="approvals">${icon('shield')}承認待ちを確認</button></div></div>
  <div class="g g6" id="kpis"></div>
  <div class="g mt" style="grid-template-columns:2fr 1fr"><div class="card"><h3>${icon('cube')}現場一覧<span class="r">撮影 → 3DGS → AIチェックの最新状況</span></h3><div class="sites" id="sites"></div></div>
    <div class="card glow" id="roleCard"></div></div>
  <div class="g g3 mt"><div class="card"><h3>${icon('chart')}AIによる削減時間（全現場・週次・試算）<span class="r">時間</span></h3><svg id="chWeek" class="ch" viewBox="0 0 360 170"></svg></div>
    <div class="card"><h3>${icon('spark')}業務別 AI処理件数</h3><div style="display:flex;align-items:center;gap:14px"><svg id="chDonut" viewBox="0 0 140 140" width="140" height="140" style="flex:none"></svg><div class="leg" id="donutLeg" style="flex:1"></div></div></div>
    <div class="card"><h3>${icon('bell')}アクティビティ<span class="r live"><i></i>LIVE（模擬）</span></h3><div class="feed" id="feed"></div></div></div>`;
  $('#sites').innerHTML=SITES.map(s=>`<div class="site" style="--c:${s.c}"><canvas width="300" height="104"></canvas>${s.live?`<span class="lv">${icon('cube')} 3Dビュー対応</span>`:''}${s.al?`<span class="al">${icon('hazard')}アラート</span>`:''}<div class="sb"><b>現場${s.id}　${s.n}</b><div class="sm"><span class="pill" style="--c:${s.c}">${icon('calendar')}撮影 ${s.last}</span><span class="pill">${icon('spark')}${s.ai}</span></div><div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--tx3);margin-top:6px"><span>進捗</span><span style="font-family:var(--mono)">${s.prog}%</span></div><div class="prog"><i data-w="${s.prog}"></i></div></div></div>`).join('');
  $$('#sites .site').forEach((el,i)=>{thumbs.push({cv:el.querySelector('canvas'),pts:genSite(SITES[i].type),o:i*1.3});el.addEventListener('click',()=>SITES[i].live?goto('viewer'):toast(`現場${SITES[i].id}の3Dデータはこのサンプルには含まれていません（現場Aのみ）`,'info','#9fb0d8'))});
  setInterval(()=>{if(page!=='dash')return;const n={...LIVE_POOL[Math.floor(Math.random()*LIVE_POOL.length)],t:new Date(),demo:true};notify(n)},12000);
},refresh(){
  const d=A.ROLE.defs[A.ROLE.cur];$('#dashHello').textContent=`ホーム ─ ${d.n}`;
  const kp=[['cube','#38e1ff','稼働現場',5,'現場',''],['drone','#8b7bff','今週の3D更新',11+S.newVer,'版','+'+(2+S.newVer)],['spark','#3ee07f','AI下書き（今週）',27+A.REP.length,'件','+'+A.REP.length],['shield','#ffb547','承認待ち',pending(),'件',''],['hazard','#ff5d6c','安全アラート（今週）',2+S.alerts,'件',''],['clock','#ff7ad9','削減時間（今週・試算）',38.5+S.tasks*0.8,'h','']];
  $('#kpis').innerHTML=kp.map(([ic,c,l,v,u,dl],i)=>`<div class="kpi" style="--c:${c};animation-delay:${i*0.06}s"><div class="ki">${icon(ic,'i')}</div><div class="kval"><span data-v="${v}" data-d="${Number.isInteger(v)?0:1}">0</span><small>${u}</small></div><div class="kl">${l}</div>${dl&&dl!=='+0'?`<span class="kd">${dl}</span>`:''}</div>`).join('');
  $$('#kpis [data-v]').forEach(e=>countUp(e,+e.dataset.v,+e.dataset.d));
  $('#roleCard').style.setProperty('--c',d.c);
  $('#roleCard').innerHTML=`<h3 style="color:${d.c}">${icon(d.ic)}<span style="color:var(--tx)">${d.n} ができること</span><span class="r">${icon('lock')}${d.grp}</span></h3><div class="caps">${d.can.map((c,i)=>`<div style="animation-delay:${i*0.1}s">${icon('checkc')}${c}</div>`).join('')}<div style="animation-delay:.3s">${icon(d.approve?'checkc':'lock')}<span>承認権限：${d.approve?'<b style="color:var(--gr)">あり</b>':'<span style="color:var(--tx3)">なし（現場代理人が承認）</span>'}</span></div></div>
    <div style="margin-top:10px;font-size:11px;color:var(--tx3)">利用できる画面</div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${PAGES.map(([k,n,ic])=>`<span class="pill" style="--c:${d.pages.includes(k)?d.c:'#4a5680'}">${icon(d.pages.includes(k)?ic:'lock')}${n}</span>`).join('')}</div>`;
  const QA={field:[['heat','AIで出来形チェック','sc:asbuilt'],['up','撮影データをアップロード','pg:pipeline'],['cube','現場Aを3Dで確認','pg:viewer']],agent:[['shield','承認待ちを確認','pg:approvals'],['hazard','AIで重機の安全離隔チェック','sc:safety'],['report','レポートを見る','rp']],hq:[['cube','現場Aを3Dで確認','pg:viewer'],['crack','AIで護岸の変状点検','sc:inspect'],['report','レポートを見る','rp']],it:[['lock','ゲートウェイ・ポリシー','pg:governance'],['drone','3DGS処理キュー','pg:pipeline'],['flow','システム構成','pg:arch']]}[A.ROLE.cur];
  $('#roleCard').insertAdjacentHTML('beforeend',`<div style="margin-top:12px;font-size:11px;color:var(--tx3)">おすすめの操作</div><div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">${QA.map(([ic,n,a],i)=>`<button class="ritem" data-qa="${a}" style="--c:${d.c};border:1px solid var(--line);animation:slidein .4s ${i*0.1}s backwards"><span class="ri">${icon(ic,'i')}</span><span><b>${n}</b></span>${icon('chev')}</button>`).join('')}</div>`);
  $$('#roleCard [data-qa]').forEach(x=>x.addEventListener('click',()=>{const[k,v]=x.dataset.qa.split(':');if(k==='sc')A.runScenario(v);else if(k==='pg')goto(v);else A.openReport()}));
  $$('#sites .prog i').forEach(i=>{i.style.width='0';requestAnimationFrame(()=>requestAnimationFrame(()=>i.style.width=i.dataset.w+'%'))});
  weekChart();donut();$('#feed').innerHTML=NOTIF.slice(-14).reverse().map(feedItem).join('');
}};
SAS.on('notif',n=>{if(page==='dash'&&P.dash._init){const f=$('#feed');f.insertAdjacentHTML('afterbegin',feedItem(n));while(f.children.length>14)f.lastChild.remove()}if(P.integration._init)chatAdd(n,true)});

/* =========================================================
   PIPELINE (撮影 → 3DGS)
   ========================================================= */
const STAGES=[['up','受信','撮影データの取り込み・欠損チェック',2],['scan','前処理','ブレ画像の除外・露出補正',2.5],['cam360','カメラ位置推定','SfM（Structure from Motion）',3],['splat','3DGS学習','ガウス粒子の最適化（GPU）',10],['target','座標合わせ','標定点・設計座標系へ変換',2.5],['mask','匿名化・公開','人物ぼかし → 版登録',2]];
const JOBS=[{id:'J-1041',site:'現場B',src:'ドローン',status:'done',prog:100,at:ago(260)},{id:'J-1042',site:'現場C',src:'地上LiDAR＋写真',status:'run',prog:38,at:ago(25),fake:true},{id:'J-1043',site:'現場E',src:'360°カメラ',status:'wait',prog:0,at:ago(8)}];
let job=null;const TR={pts:null,loss:[],q:0};
function trainInit(){const n=900,pts=[];for(let i=0;i<n;i++){let x,y,c;const r=Math.random();
    if(r<0.45){x=Math.random()*2-1;y=0.62+Math.random()*0.3;c=[.55+Math.random()*.1,.45,.32]}else if(r<0.8){const u=Math.random()*1.2-0.75;const top=Math.abs(u+0.15)<0.32;y=top?0.32:0.32+(Math.abs(u+0.15)-0.32)*0.95;y+=Math.random()*0.04;x=u;c=top?[.86,.72,.5]:[.76,.6,.42]}else{x=0.55+Math.random()*0.45;y=0.7+Math.random()*0.25;c=[.2,.45,.8]}
    pts.push({tx:x,ty:y,c,sx:Math.random()*2-1,sy:Math.random(),r:0.6+Math.random()*1.6})}TR.pts=pts;TR.loss=[]}
function drawTrain(){const cv=$('#trainCv');if(!cv)return;const x=cv.getContext('2d'),w=cv.width,h=cv.height;x.clearRect(0,0,w,h);if(!TR.pts)trainInit();const q=TR.q,e=ease(q);
  for(const p of TR.pts){const jx=(1-e)*(Math.random()-.5)*0.05,px=lerp(p.sx,p.tx,e)+jx,py=lerp(p.sy,p.ty,e);const g=0.5;const r=lerp(g,p.c[0],e),gg=lerp(g,p.c[1],e),b=lerp(g+.1,p.c[2],e);const rad=(1.2+p.r*3*e)*(w/600);
    const grd=x.createRadialGradient((px*0.5+0.5)*w,py*h,0,(px*0.5+0.5)*w,py*h,rad*2);grd.addColorStop(0,`rgba(${r*255|0},${gg*255|0},${b*255|0},${0.35+0.55*e})`);grd.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=grd;x.fillRect((px*0.5+0.5)*w-rad*2,py*h-rad*2,rad*4,rad*4)}
  if(TR.loss.length>1){x.strokeStyle='#ff7ad9';x.lineWidth=2;x.beginPath();TR.loss.forEach((l,i)=>{const X=w-210+i/(Math.max(60,TR.loss.length))*200,Y=78-l/0.34*60;i?x.lineTo(X,Y):x.moveTo(X,Y)});x.stroke();x.fillStyle='#ff9be3';x.font='11px monospace';x.fillText('loss',w-210,12)}
  x.fillStyle='rgba(159,176,216,.8)';x.font='11px sans-serif';x.fillText(job?`${job.id} ${job.site} ─ ${STAGES[job.stage]?STAGES[job.stage][1]:'完了'}`:'待機中 ─ 「撮影データをアップロード」で処理を開始',10,h-10)}
function stagesHTML(){return STAGES.map(([ic,n,sub],i)=>{const st=!job?'':i<job.stage||job.status==='done'?'done':i===job.stage?'act':'';const pr=st==='done'?1:st==='act'?job.sp:0;
  return (i?`<div class="conn ${st==='act'||st==='done'?'on':''}"></div>`:'')+`<div class="stg ${st}"><div class="ring">${ring(pr,st==='done'?'#3ee07f':'#38e1ff')}<div class="ic">${icon(ic,'i lg')}</div></div><b>${i+1}. ${n}</b><small>${sub}</small><span class="ss">${st==='done'?'完了':st==='act'?Math.round(pr*100)+'%':'待機'}</span></div>`}).join('')}
function jobsHTML(){const all=job?[job,...JOBS]:JOBS;return`<table class="tbl"><thead><tr><th>ジョブ</th><th>現場</th><th>撮影ソース</th><th>状態</th><th style="width:34%">進捗</th><th>登録</th></tr></thead><tbody>${all.map(j=>{const c=j.status==='done'?'#3ee07f':j.status==='run'?'#38e1ff':'#9fb0d8';return`<tr><td class="mono">${j.id}</td><td>${j.site}</td><td>${j.src}</td><td><span class="pill" style="--c:${c}">${j.status==='done'?icon('checkc')+'完了':j.status==='run'?icon('refresh')+'処理中':icon('clock')+'待機'}</span></td><td><div class="prog ${j.status==='run'?'st':''}"><i style="width:${j.prog}%"></i></div></td><td class="mono">${md(j.at)}</td></tr>`}).join('')}</tbody></table>`}
function gpuHTML(){const busy=job&&job.status==='run';const u=busy?(job.stage===3?88+Math.random()*9:35+Math.random()*20):6+Math.random()*5;const v=busy?(job.stage===3?17.5+Math.random()*1.5:6+Math.random()):1.2;const tC=busy?68+Math.random()*6:38+Math.random()*2;
  return `<div>${gauge(u,'#38e1ff','GPU使用率')}</div><div>${gauge(v/24*100,'#8b7bff','VRAM '+v.toFixed(1)+'/24GB')}</div><div>${gauge(tC,'#ffb547','温度','℃')}</div>`}
function pipeCost(){const f=+$('#cF').value,a=+$('#cA').value,q=$('#cQ').value,pr=+$('#cP').value;$('#oF').textContent=f+'回/週';$('#oA').textContent=a+'ha';
  const perRun=a*(q==='hi'?1.6:0.8);const hrs=perRun*f*4.3;$('#cH').textContent=hrs.toFixed(1)+' GPU時間/月';$('#cY').textContent=yen(hrs*pr);$('#cS').textContent=(a*(q==='hi'?0.9:0.45)*f*4.3).toFixed(1)+' GB/月'}
P.pipeline={init(){
  $('#pg-pipeline').innerHTML=`<div class="pg-h" style="--c:#38e1ff"><div class="pi">${icon('drone','i lg')}</div><div><h2>データ取得 ─ 撮影から3DGS生成まで</h2><p>ドローン・360°カメラ・地上LiDARの撮影データをGPUサーバで自動処理し、3DGSの「版」として3D基盤に登録します（処理は模擬）。</p></div><div class="act"><button class="hbtn" id="plUp" style="border-color:var(--cy)">${icon('up')}撮影データをアップロード（模擬）</button></div></div>
  <div class="srcs"><div class="card src" style="--c:#38e1ff"><div class="sic fly">${icon('drone','i xl')}</div><div><b>ドローン写真測量</b><small>広域・盛土/切土の面管理向け。週1回〜。RTK-GNSSと標定点で位置精度を確保。</small></div></div>
    <div class="card src" style="--c:#8b7bff"><div class="sic rot">${icon('cam360','i xl')}</div><div><b>360°カメラ巡回</b><small>歩行撮影で日次更新。足場・構造物まわりの状況記録と安全確認向け。</small></div></div>
    <div class="card src" style="--c:#ffb547"><div class="sic scan">${icon('lidar','i xl')}</div><div><b>地上LiDAR</b><small>正式な出来形計測の精度担保に使用。3DGSと同じ座標で重ね合わせ。</small></div></div></div>
  <div class="card mt glow" style="--c:var(--cy)"><h3>${icon('flow')}処理パイプライン<span class="r" id="plState">待機中</span></h3><div class="stages" id="stages"></div></div>
  <div class="g mt" style="grid-template-columns:1.5fr 1fr"><div class="card"><h3>${icon('splat')}3DGS学習のようす（ガウス粒子の最適化）<span class="r">${icon('gpu')}GPUサーバ #1</span></h3><canvas id="trainCv" width="760" height="230"></canvas>
      <div class="stats"><div class="stat"><small>Iteration</small><b id="tIt">0</b></div><div class="stat"><small>Loss</small><b id="tLo">-</b></div><div class="stat"><small>PSNR</small><b id="tPs">-</b></div><div class="stat"><small>スプラット数</small><b id="tSp">0</b></div></div></div>
    <div class="card"><h3>${icon('gauge')}GPUリソース<span class="r live"><i></i>LIVE</span></h3><div class="gauges" id="gauges"></div>
      <h3 class="mt">${icon('yen')}撮影頻度と費用の目安<span class="r">試算（サンプル単価）</span></h3>
      <div class="sl"><span>撮影頻度</span><input type="range" id="cF" min="1" max="7" value="1"><output id="oF"></output></div>
      <div class="sl"><span>処理範囲</span><input type="range" id="cA" min="1" max="20" value="4"><output id="oA"></output></div>
      <div class="sl"><span>品質</span><select id="cQ" style="background:#0c1430;color:var(--tx);border:1px solid var(--line2);border-radius:7px;padding:4px"><option value="std">標準</option><option value="hi">高品質</option></select><span></span></div>
      <div class="sl"><span>GPU単価（円/時）</span><input type="number" id="cP" value="450" style="width:100%;background:#0c1430;color:var(--tx);border:1px solid var(--line2);border-radius:7px;padding:4px 6px"><span></span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px"><div class="stat"><small>GPU時間</small><b id="cH" style="font-size:12px"></b></div><div class="stat"><small>概算費用/月</small><b id="cY" style="color:var(--am)"></b></div><div class="stat"><small>保存容量</small><b id="cS" style="font-size:12px"></b></div></div></div></div>
  <div class="card mt"><h3>${icon('list')}処理キュー</h3><div id="jobs"></div></div>`;
  ['cF','cA','cQ','cP'].forEach(id=>$('#'+id).addEventListener('input',pipeCost));pipeCost();
  $('#plUp').addEventListener('click',startJob);
  setInterval(()=>{if(page==='pipeline')$('#gauges').innerHTML=gpuHTML();const f=JOBS.find(j=>j.fake);if(f&&f.prog<92){f.prog+=0.4;if(page==='pipeline'&&!job)$('#jobs').innerHTML=jobsHTML()}},700);
  const loop=()=>{if(page==='pipeline')drawTrain();requestAnimationFrame(loop)};loop();
},refresh(){$('#stages').innerHTML=stagesHTML();$('#jobs').innerHTML=jobsHTML();$('#gauges').innerHTML=gpuHTML();$('#plUp').disabled=!!(job&&job.status==='run');
  const can=['field','it'].includes(A.ROLE.cur);$('#plUp').style.opacity=can?1:.5;$('#plUp').title=can?'':'アップロードは現場担当者・IT部門のみ（模擬）'}};
async function startJob(){
  if(!['field','it'].includes(A.ROLE.cur)){toast('撮影データのアップロードは「現場担当者」または「IT・DX部門」ロールで行えます','lock','#ffb547');return}
  if(job&&job.status==='run')return;
  job={id:'J-'+(1044+S.newVer),site:'現場A',src:'ドローン（412枚）',status:'run',prog:0,stage:0,sp:0,at:new Date()};TR.q=0;trainInit();A.audit('HUMAN','UPLOAD','現場A ドローン撮影 412枚 → 3DGS生成ジョブ '+job.id);toast(`${job.id}：撮影データを受信しました。3DGS生成を開始します`,'up','#38e1ff');
  $('#plUp').disabled=true;const total=STAGES.reduce((s,x)=>s+x[3],0);let done=0;
  for(let i=0;i<STAGES.length;i++){job.stage=i;const dur=STAGES[i][3]*1000;const t0=performance.now();$('#plState').textContent=`${job.id} ─ ${STAGES[i][1]}`;
    await new Promise(res=>{const tick=()=>{const p=Math.min(1,(performance.now()-t0)/dur);job.sp=p;job.prog=Math.round((done+STAGES[i][3]*p)/total*100);
      if(i===3){TR.q=p;const it=Math.round(p*30000);$('#tIt').textContent=it.toLocaleString();const loss=0.32*Math.exp(-4*p)+0.018+Math.random()*0.006;TR.loss.push(loss);if(TR.loss.length>120)TR.loss.shift();$('#tLo').textContent=loss.toFixed(4);$('#tPs').textContent=(14+17*(1-Math.exp(-3*p))).toFixed(1)+'dB';$('#tSp').textContent=Math.round(2000+p*10444).toLocaleString()}
      if(page==='pipeline'){$('#stages').innerHTML=stagesHTML();if(Math.random()<.2)$('#jobs').innerHTML=jobsHTML()}
      if(p<1)setTimeout(tick,120);else res()};tick()});done+=STAGES[i][3]}
  job.status='done';job.prog=100;TR.q=1;$('#plState').textContent=`${job.id} ─ 完了`;
  S.newVer++;const v=C.VER.list[C.VER.list.length-1];C.VER.list.push({d:'2026-11-20',label:'11/20'+(S.newVer>1?'-'+S.newVer:''),p:v.p,s:v.s,isNew:true});A.buildVerBar();A.setVersion(C.VER.idx,true);
  A.audit('SYSTEM','VERSION_ADD',`現場A 3DGS 版 ${C.VER.list[C.VER.list.length-1].label} を登録（${job.id}）`);
  notify({ic:'drone',c:'#38e1ff',site:'現場A',title:`3DGS生成完了：現場A ${C.VER.list[C.VER.list.length-1].label}版`,body:`${job.id} ドローン412枚 → 12,444 スプラット。人物の匿名化・座標合わせ済み。3Dビューの4D版から選べます。`,act:'data'});
  toast('3DGS生成が完了し、新しい版を3D基盤に登録しました（3Dビューの4Dバーに NEW）','checkc','#3ee07f',4500);
  JOBS.unshift(job);job=null;if(page==='pipeline')P.pipeline.refresh();
}

/* =========================================================
   DATA (3D基盤)
   ========================================================= */
const CATALOG=[['splat','3DGS','現場A_3DGS_1118.splat','186 MB','sha256:9f2c…a71e','11/18','#38e1ff'],['lidar','点群（LiDAR）','現場A_LiDAR_1115.laz','1.2 GB','sha256:41bd…0c9a','11/15','#ffb547'],['design','設計（LandXML）','築堤_設計面_rev3.xml','8.4 MB','sha256:e07a…553f','10/01','#3ee07f'],['cube','設計（IFC/BIM）','護岸工_rev2.ifc','36 MB','sha256:b3c1…92de','10/01','#8b7bff'],['camera','画像','現場A_drone_1118.zip','2.9 GB','sha256:77aa…e310','11/18','#9fb0d8']];
P.data={init(){
  $('#pg-data').innerHTML=`<div class="pg-h" style="--c:#8b7bff"><div class="pi">${icon('db','i lg')}</div><div><h2>3Dデータ基盤 ─ 同じ座標で重ねて、日付ごとに版管理</h2><p>3DGS・点群・設計データを同一座標系で統合し、撮影日ごとの「版」として保管します。版を並べると時間軸付きの4Dになります。</p></div><div class="act"><button class="hbtn" id="dMerge">${icon('layers')}重ね合わせを実演</button></div></div>
  <div class="g g3"><div class="card"><h3>${icon('calendar')}現場A の版（4D）<span class="r">${icon('cube')}○○川 築堤・護岸工事</span></h3><div id="vers"></div><svg id="volCh" class="ch mt" viewBox="0 0 340 120"></svg></div>
    <div class="card glow" style="--c:var(--vi)"><h3>${icon('layers')}座標統合（レイヤ構成）<span class="r">平面直角座標系＋標高（例）</span></h3><div class="stack3d" id="stk">
      <div class="pl" style="--c:#3ee07f;--z:120px"><span>${icon('design')}設計データ（LandXML / IFC）</span></div><div class="pl" style="--c:#38e1ff;--z:60px"><span>${icon('splat')}3DGS（見た目・状況）</span></div><div class="pl" style="--c:#ffb547;--z:0px"><span>${icon('lidar')}点群（LiDAR・精度担保）</span></div><div class="pl" style="--c:#8d7a52;--z:-60px"><span>${icon('target')}地形・標定点（座標基準）</span></div><div class="ok3">${icon('checkc')}同一座標系で統合済み（ずれ 0.02m 以内・例）</div></div></div>
    <div class="card"><h3>${icon('lock')}アクセス制御（現場 × ロール）</h3><table class="tbl rbac"><thead><tr><th>データ</th><th>担当</th><th>代理人</th><th>本社</th><th>IT</th></tr></thead><tbody>
      ${[['3DGS・画像','y','y','y','q'],['点群・設計','y','y','y','q'],['人物を含む原画像','n','q','n','q'],['承認済み帳票','y','y','y','y'],['監査ログ','n','q','q','y']].map(r=>`<tr><td>${r[0]}</td>${r.slice(1).map(v=>`<td class="${v}">${v==='y'?icon('checkc'):v==='q'?icon('shield'):icon('x')}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <div style="font-size:11px;color:var(--tx3);margin-top:8px;line-height:1.6">${icon('shield')} 管理目的のみ・申請制　｜　原画像は匿名化前のため最小権限。保存期間は「統制」画面で設定。</div></div></div>
  <div class="card mt"><h3>${icon('list')}データカタログ（現場A）<span class="r">ハッシュで改ざん検知・版と紐づけ</span></h3><table class="tbl"><thead><tr><th></th><th>種別</th><th>ファイル</th><th>容量</th><th>ハッシュ</th><th>登録</th></tr></thead><tbody>${CATALOG.map(r=>`<tr><td style="color:${r[6]}">${icon(r[0])}</td><td><span class="pill" style="--c:${r[6]}">${r[1]}</span></td><td>${r[2]}</td><td class="mono">${r[3]}</td><td class="mono">${r[4]}</td><td class="mono">${r[5]}</td></tr>`).join('')}</tbody></table></div>`;
  $('#dMerge').addEventListener('click',()=>{const s=$('#stk');GOV._stkHold=true;s.classList.toggle('merged');A.audit('HUMAN','VIEW','座標統合の実演')});
  setInterval(()=>{if(page==='data'&&!GOV._stkHold)$('#stk').classList.toggle('merged')},3200);
},refresh(){
  const des=A.embBalance();const cur=C.VER.idx;const base=des.current/C.VER.p;
  $('#vers').innerHTML=C.VER.list.map((v,i)=>`<div class="vrow ${i===cur?'cur':''}"><span class="d">${v.label}</span><div><div class="prog" style="margin:0"><i style="width:${v.p*100}%"></i></div><span class="mono">盛土 ${Math.round(v.p*100)}% ・ ${(12444-(5-Math.min(i,5))*310).toLocaleString()} splats</span></div><span>${v.isNew?'<span class="pill" style="--c:var(--pk)">NEW</span>':i===cur?'<span class="pill" style="--c:var(--cy)">表示中</span>':''}</span><button class="mini" data-ov="${i}">${icon('cube')}開く</button></div>`).join('');
  $$('#vers [data-ov]').forEach(b=>b.addEventListener('click',()=>{A.setVersion(+b.dataset.ov);goto('viewer')}));
  const vals=C.VER.list.map(v=>base*v.p),mx=base*1.1,W=340,H=120,L=36;let h=`<text x="2" y="12" fill="#6c7ba4" font-size="9">盛土 体積（m³）</text>`;
  const pts=vals.map((v,i)=>[L+i*(W-L-10)/(vals.length-1),H-18-(v/mx)*(H-34)]);
  h+=`<line x1="${L}" x2="${W}" y1="${H-18-(des.design/mx)*(H-34)}" y2="${H-18-(des.design/mx)*(H-34)}" stroke="#3ee07f" stroke-dasharray="4 4"/><text x="${W-4}" y="${H-22-(des.design/mx)*(H-34)}" fill="#3ee07f" font-size="9" text-anchor="end">設計 ${Math.round(des.design)}</text>`;
  h+=`<polygon points="${L},${H-18} ${pts.map(p=>p.join(',')).join(' ')} ${pts[pts.length-1][0]},${H-18}" fill="rgba(56,225,255,.12)"/><polyline class="drawl" points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#38e1ff" stroke-width="2"/>`;
  pts.forEach((p,i)=>h+=`<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${i===cur?'#ff7ad9':'#38e1ff'}"/><text x="${p[0]}" y="${H-5}" fill="#6c7ba4" font-size="8.5" text-anchor="middle">${C.VER.list[i].label}</text>`);
  $('#volCh').innerHTML=h;
}};

/* =========================================================
   APPROVALS
   ========================================================= */
const APS=[
  {id:'AP-091',site:'現場C',title:'坑口部 変状点検調書（ドラフト）',risk:'中',task:'変状点検',model:'claude',status:'pending',req:ago(55),kv:[['ひび割れ','2件（Ⅱ判定）']]},
  {id:'AP-092',site:'現場B',title:'クレーン作業 安全離隔チェック結果の登録',risk:'中',task:'安全離隔',model:'openai',status:'pending',req:ago(32),kv:[['最小離隔','1.4m（注意）']]},
  {id:'AP-088',site:'現場D',title:'土量照合結果（第3工区）',risk:'中',task:'土量計算',model:'coop',status:'approved',by:'現場代理人・所長（SG-現場D-代理人）',at:ago(1440),req:ago(1500)},
  {id:'AP-085',site:'現場E',title:'堤体補修 出来形（左岸側）',risk:'中',task:'出来形管理',model:'claude',status:'rejected',by:'現場代理人・所長（SG-現場E-代理人）',at:ago(2900),req:ago(3000),note:'計測範囲不足のため再撮影'}];
SAS.on('approval',r=>{if(!APS.includes(r))APS.push(r);badge();if(page==='approvals'&&P.approvals._init)P.approvals.refresh()});
const STL={pending:['st-p','承認待ち','clock'],approved:['st-a','承認','checkc'],rejected:['st-r','却下','x'],auto:['st-x','自動承認（デモ）','shield']};
function decide(id,ok){if(window.__SAS_REAL__&&window.__SAS_REAL__.decide)return window.__SAS_REAL__.decide(id,ok);const a=APS.find(x=>x.id===id);if(!a)return;const d=A.ROLE.defs[A.ROLE.cur];if(!d.approve){toast(`「${d.n}」には承認権限がありません。右上のロールで「現場代理人・所長」に切り替えてください`,'lock','#ffb547',4200);return}
  if(a===A.APPROVALS.find(x=>x.id===id)&&A.AG.approveRes){A.AG.approveRes(ok);return}
  Object.assign(a,{status:ok?'approved':'rejected',by:`${d.n}（${d.grp}）`,at:new Date()});A.audit('HUMAN',ok?'APPROVED':'REJECTED',`${a.site} ${a.title}`);toast((ok?'承認しました：':'却下しました：')+a.title,ok?'checkc':'x',ok?'#3ee07f':'#ff5d6c');
  notify({ic:ok?'checkc':'x',c:ok?'#3ee07f':'#ff5d6c',site:a.site,title:`${ok?'承認':'却下'}：${a.title}`,body:`${d.n} が${ok?'承認しました。連携・保管処理に進みます。':'却下しました。担当者に差し戻します。'}`,act:'approvals'});badge();P.approvals.refresh()}
P.approvals={init(){
  $('#pg-approvals').innerHTML=`<div class="pg-h" style="--c:#ffb547"><div class="pi">${icon('shield','i lg')}</div><div><h2>承認 ─ AIは下書きまで、確定は人</h2><p>AIの作成物（帳票・判定・停止指示）は、権限を持つ人が承認して初めて確定します。承認・却下はすべて監査ログに残ります。</p></div></div>
  <div class="card glow" style="--c:var(--am)"><div class="flow">${[['spark','AIが下書き','計測・判定・帳票','#f0956a'],['worker','担当者が確認','内容・前提の確認','#38e1ff'],['shield','代理人が承認','確定・提出・停止','#3ee07f'],['office','本社が閲覧','横断確認・分析','#8b7bff'],['link','連携・保管','通知・保存・原価','#ff7ad9']].map(([ic,n,s,c],i)=>(i?'<div class="farr"></div>':'')+`<div class="fstep" style="--c:${c};--d:${i*0.7}s"><div class="fc">${icon(ic,'i')}</div><b>${n}</b><small>${s}</small></div>`).join('')}</div></div>
  <div class="g mt" style="grid-template-columns:1fr 1.25fr"><div class="card"><h3>${icon('clock')}承認待ち<span class="r" id="apWho"></span></h3><div id="apPend"></div></div><div class="card"><h3>${icon('list')}承認履歴</h3><div id="apHist" style="max-height:470px;overflow:auto"></div></div></div>`;
},refresh(){
  const d=A.ROLE.defs[A.ROLE.cur];$('#apWho').innerHTML=d.approve?`<span style="color:var(--gr)">${icon('checkc')}あなた（${d.n}）は承認できます</span>`:`<span style="color:var(--am)">${icon('lock')}${d.n}：閲覧のみ</span>`;
  const pend=APS.filter(a=>a.status==='pending');
  $('#apPend').innerHTML=pend.length?pend.map((a,i)=>`<div class="apc" style="animation-delay:${i*0.08}s"><span class="aic">${icon('shield','i')}</span>${a.img?`<img src="${a.img}" alt="">`:''}<div style="min-width:0"><b>${esc(a.site)}　${esc(a.title)}</b><small>${a.id} ・ ${esc(a.task||'')} ・ AI：${A.MNAME[a.model==='coop'?'claude':a.model]||a.model}${a.model==='coop'?'（協調）':''} ・ 依頼 ${md(a.req)} ・ 影響度 ${a.risk}</small>${(a.kv||[]).slice(0,2).map(([k,v])=>`<small>${esc(k)}：${esc(v)}</small>`).join('')}</div><div class="ab"><button class="btn dan" data-dec="${a.id}" data-ok="0" ${d.approve?'':'disabled'}>${icon('x')}却下</button><button class="btn pri" data-dec="${a.id}" data-ok="1" ${d.approve?'':'disabled'}>${icon('check')}承認</button></div></div>`).join(''):`<div class="empty" style="text-align:center;padding:24px">${icon('checkc','i xl')}<br>承認待ちはありません</div>`;
  $$('#apPend [data-dec]').forEach(b=>b.addEventListener('click',()=>decide(b.dataset.dec,b.dataset.ok==='1')));
  const hist=APS.filter(a=>a.status!=='pending').sort((x,y)=>new Date(y.at)-new Date(x.at));
  $('#apHist').innerHTML=`<table class="tbl"><thead><tr><th>ID</th><th>現場</th><th>件名</th><th>結果</th><th>承認者</th><th>日時</th></tr></thead><tbody>${hist.map(a=>{const[cl,n,ic]=STL[a.status];return`<tr><td class="mono">${a.id}</td><td>${a.site}</td><td>${esc(a.title)}${a.note?`<div style="font-size:10.5px;color:var(--tx3)">${esc(a.note)}</div>`:''}</td><td><span class="pill ${cl}">${icon(ic)}${n}</span></td><td style="font-size:11px">${esc(a.by||'')}</td><td class="mono">${md(a.at)}</td></tr>`}).join('')}</tbody></table>`;
  badge();
}};

/* =========================================================
   INTEGRATION
   ========================================================= */
const SCHED=[{n:'毎朝 7:30 出来形チェック（現場A）',sc:'asbuilt',cron:'30 7 * * 1-6',ic:'heat',c:'#38e1ff',on:true},{n:'毎時 重機の安全離隔チェック',sc:'safety',cron:'0 * * * *（作業時間帯）',ic:'hazard',c:'#ff5d6c',on:true},{n:'3DGS更新時 土量照合',sc:'earthwork',cron:'トリガー：新しい版の登録',ic:'volume',c:'#ffb547',on:true},{n:'毎週月曜 護岸の変状点検',sc:'inspect',cron:'0 9 * * 1',ic:'crack',c:'#8b7bff',on:false}];
const MAPS=[['asbuilt','出来形判定','品質管理記録（出来形）','heat','#38e1ff'],['earthwork','土量・運搬計画','出来高・原価（運搬費）','volume','#ffb547'],['safety','安全離隔チェック','安全日誌・KY記録','hazard','#ff5d6c'],['inspect','護岸 変状点検','維持管理台帳','crack','#8b7bff']];
let syncDest='dc';const SYNCED=new Set();
function chatCard(n){return`<div class="tm"><div class="tav">${icon('spark')}</div><div style="min-width:0"><div class="tw"><b>Spatial Agent（Bot）</b>${md(n.t)}</div><div class="tcard" style="--c:${n.c}"><div class="tt">${icon(n.ic)}${esc(n.title)}</div><p>${esc(n.body||'')}</p><div class="tb">${n.act==='viewer'||n.site==='現場A'?`<button data-ca="viewer">${icon('cube')} 3Dで見る</button>`:''}${n.act==='approvals'?`<button data-ca="approvals">${icon('shield')} 承認画面へ</button>`:''}${n.act==='report'?`<button data-ca="report">${icon('report')} レポート</button>`:''}${n.act==='data'?`<button data-ca="data">${icon('db')} 3D基盤</button>`:''}</div></div></div></div>`}
function chatAdd(n,scroll){const b=$('#chatBody');if(!b)return;b.insertAdjacentHTML('beforeend',chatCard(n));b.lastElementChild.querySelectorAll('[data-ca]').forEach(x=>x.addEventListener('click',()=>act(x.dataset.ca)));if(scroll)b.scrollTop=b.scrollHeight}
function files(){const f=[['report','出来形管理_2026-11-13.html','412 KB'],['splat','現場A_3DGS_1118.splat','186 MB'],['shield','監査ログ_2026-11.json','96 KB']];A.REP.forEach(r=>f.push(['report',`${r.id}_${r.title}.html`,'~300 KB']));return f}
function syncHTML(){return files().map(([ic,n,sz])=>{const k=syncDest+n;return`<div class="fl"><span style="color:var(--cy)">${icon(ic)}</span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(n)}<div class="prog" style="margin-top:3px"><i style="width:${SYNCED.has(k)?100:0}%"></i></div></span><span class="mono">${SYNCED.has(k)?'<span style="color:var(--gr)">✓ 同期済</span>':sz}</span></div>`}).join('')}
function mapHTML(){return MAPS.map(([k,a,b,ic,c])=>{const r=[...A.REP].reverse().find(x=>x.type===k);return`<div class="map" data-m="${k}"><span style="display:flex;align-items:center;gap:6px;color:${c}">${icon(ic)}<span style="color:var(--tx)">${a}</span></span><div class="ar"></div><span>${b}</span><span class="pill" style="--c:${r?'#3ee07f':'#6c7ba4'}">${r?icon('checkc')+'連携可':icon('clock')+'データ待ち'}</span></div>`}).join('')}
P.integration={init(){
  $('#pg-integration').innerHTML=`<div class="pg-h" style="--c:#ff7ad9"><div class="pi">${icon('link','i lg')}</div><div><h2>連携 ─ 通知・帳票・保存・原価・定期実行</h2><p>AIの結果をTeams通知、帳票出力、DirectCloud／SharePointへの保存、施工管理・原価システムへ連携します（すべて模擬・外部送信なし）。</p></div></div>
  <div class="g" style="grid-template-columns:1.15fr 1fr"><div class="card"><h3>${icon('chat')}Teams通知（連携イメージ）<span class="r live"><i></i>このセッションの通知</span></h3>
      <div class="chat"><div class="chs"><div style="color:var(--tx3);font-size:10.5px">チャネル</div><div class="on"># 現場A-施工管理<i id="chN">0</i></div><div># 現場B-下部工</div><div># 安全衛生</div><div># 全社-AI通知</div></div><div class="chm"><div class="chh">${icon('chat')}# 現場A-施工管理<span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--tx3)">Bot：Spatial Agent</span></div><div class="chb" id="chatBody"></div></div></div></div>
    <div><div class="card"><h3>${icon('calendar')}定期実行（スケジュール）</h3><div id="sched"></div></div>
      <div class="card mt"><h3>${icon('cloud')}保存先の同期<span class="r"><button class="mini ${syncDest==='dc'?'':''}" data-sd="dc">DirectCloud</button><button class="mini" data-sd="sp">SharePoint</button></span></h3><div id="sync"></div><div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="syncGo">${icon('refresh')}同期を実行（模擬）</button></div></div></div></div>
  <div class="g g2 mt"><div class="card"><h3>${icon('db')}施工管理・原価システムへの連携<span class="r">AIの結果 → 既存システムの項目</span></h3><div id="maps"></div><div style="display:flex;gap:8px;margin-top:10px"><button class="btn pri" id="mapGo">${icon('bolt')}連携を実行（模擬）</button></div></div>
    <div class="card"><h3>${icon('report')}帳票出力</h3><div class="g g2" style="gap:8px">
      <button class="btn" id="exOpen">${icon('report')}レポートを開く</button><button class="btn" id="exHtml">${icon('download')}HTMLで保存</button><button class="btn" id="exJson">${icon('download')}JSONで保存</button><button class="btn" id="exAud">${icon('shield')}監査ログJSON</button><button class="btn" disabled>${icon('report')}Word（本番で対応）</button><button class="btn" disabled>${icon('report')}PDF（本番で対応）</button></div>
      <div class="note">本番ではWord/PDF帳票を社内テンプレートで生成し、承認済みのものだけを保存先へ自動登録する想定です。</div></div></div>`;
  NOTIF.forEach(n=>chatAdd(n,false));$('#chatBody').scrollTop=1e6;
  $('#sched').innerHTML=SCHED.map((s,i)=>`<div class="sched" style="--c:${s.c}"><span class="sci">${icon(s.ic,'i')}</span><div><b>${s.n}</b><small>${s.cron}</small></div><div class="sa"><span class="sw2 ${s.on?'on':''}" data-sc="${i}"></span><button class="mini" data-run="${i}">${icon('play')}今すぐ</button></div></div>`).join('');
  $$('#sched [data-sc]').forEach(e=>e.addEventListener('click',()=>{const s=SCHED[+e.dataset.sc];s.on=!s.on;e.classList.toggle('on',s.on);A.audit('HUMAN','SCHEDULE',`${s.n} ${s.on?'有効':'無効'}`)}));
  $$('#sched [data-run]').forEach(e=>e.addEventListener('click',()=>{const s=SCHED[+e.dataset.run];A.runScenario(s.sc,'定期実行（手動起動）：'+s.n)}));
  $$('[data-sd]').forEach(b=>b.addEventListener('click',()=>{syncDest=b.dataset.sd;$$('[data-sd]').forEach(x=>x.style.borderColor=x===b?'var(--cy)':'');$('#sync').innerHTML=syncHTML()}));$('[data-sd="dc"]').style.borderColor='var(--cy)';
  $('#syncGo').addEventListener('click',async()=>{const rows=$$('#sync .fl');const fs=files();for(let i=0;i<rows.length;i++){const k=syncDest+fs[i][1];if(SYNCED.has(k))continue;const bar=rows[i].querySelector('.prog i');bar.parentElement.classList.add('st');for(let p=0;p<=100;p+=8){bar.style.width=p+'%';await new Promise(r=>setTimeout(r,45))}SYNCED.add(k);rows[i].querySelector('.mono').innerHTML='<span style="color:var(--gr)">✓ 同期済</span>';bar.parentElement.classList.remove('st')}
    A.audit('SYSTEM','SYNC',`${syncDest==='dc'?'DirectCloud':'SharePoint'} へ ${fs.length} 件同期（模擬）`);notify({ic:'cloud',c:'#ff7ad9',site:'現場A',title:`保存先同期完了（${syncDest==='dc'?'DirectCloud':'SharePoint'}）`,body:`レポート・3DGS・監査ログ ${fs.length} 件を保存しました（模擬）。`,act:'dash'})});
  $('#mapGo').addEventListener('click',async()=>{let n=0;for(const row of $$('#maps .map')){const k=row.dataset.m;if(!A.REP.some(r=>r.type===k))continue;const ar=row.querySelector('.ar');ar.classList.add('go');await new Promise(r=>setTimeout(r,900));ar.classList.remove('go');row.querySelector('.pill').outerHTML=`<span class="pill" style="--c:#3ee07f">${icon('checkc')}送信済（模擬）</span>`;n++}
    if(!n){toast('連携できる結果がまだありません。AIタスクを実行して承認してください','info','#9fb0d8');return}A.audit('SYSTEM','INTEGRATION',`施工管理・原価システムへ ${n} 件連携（模擬）`);toast(`施工管理・原価システムへ ${n} 件を連携しました（模擬）`,'bolt','#3ee07f')});
  $('#exOpen').addEventListener('click',()=>A.openReport());$('#exHtml').addEventListener('click',()=>{A.openReport();$('#repHtml').click()});$('#exJson').addEventListener('click',()=>$('#repJson').click());$('#exAud').addEventListener('click',()=>$('#audExport').click());
},refresh(){$('#sync').innerHTML=syncHTML();$('#maps').innerHTML=mapHTML();$('#chN').textContent=NOTIF.length;$('#chatBody').scrollTop=1e6}};

/* =========================================================
   GOVERNANCE
   ========================================================= */
const GOV={price:1500,budget:80000,perMonth:300,tampered:null,retention:'工期終了＋5年'};
function apiLogHTML(){return S.log.length?`<table class="tbl"><thead><tr><th>時刻</th><th>モデル</th><th>種別</th><th>内容</th><th>推定トークン</th><th>判定</th></tr></thead><tbody>${S.log.slice(-14).reverse().map(l=>`<tr><td class="mono">${hm(l.t)}</td><td style="color:${l.model==='claude'?'var(--cl)':'var(--oa)'}">${A.MNAME[l.model]||l.model}</td><td>${l.kind==='computer'?'computer use':l.kind==='function'?'function':'message'}</td><td class="mono">${esc(l.name||'')}${l.test?'（テスト）':''}</td><td class="mono">${Math.round(l.tokens||0)}</td><td>${l.blocked?'<span class="pill st-r">'+icon('x')+'拒否</span>':'<span class="pill st-a">'+icon('check')+'許可</span>'}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">まだAPI呼び出しはありません。AIタスクを実行するか「テスト送信」を押してください。</div>'}
function costHTML(){const cost=S.tok/1e6*GOV.price;const avg=S.tasks?S.taskTok/S.tasks:9000;const proj=avg*GOV.perMonth/1e6*GOV.price;const pct=proj/GOV.budget*100;
  return`<div class="gauge-big"><div style="width:130px;text-align:center;flex:none" class="gauges" ><div style="grid-column:1/4">${gauge(Math.min(100,pct),pct>90?'#ff5d6c':pct>70?'#ffb547':'#3ee07f','予算消化（月見込み）')}</div></div><div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <div class="stat"><small>API呼び出し（今回）</small><b>${S.api}</b></div><div class="stat"><small>拒否（ポリシー）</small><b style="color:var(--rd)">${S.blocked}</b></div><div class="stat"><small>推定トークン</small><b>${Math.round(S.tok).toLocaleString()}</b></div><div class="stat"><small>推定費用（今回）</small><b style="color:var(--am)">${yen(cost)}</b></div>
    <div class="stat" style="grid-column:1/3"><small>月間見込み（1タスク平均 ${Math.round(avg).toLocaleString()} トークン × ${GOV.perMonth} タスク）</small><b class="bigv">${yen(proj)}</b> <span style="font-size:11px;color:var(--tx3)">／ 予算 ${yen(GOV.budget)}</span></div></div></div>
    <div class="sl" style="grid-template-columns:150px 1fr"><span>単価 円/100万トークン</span><input type="number" id="gP" value="${GOV.price}" style="background:#0c1430;color:var(--tx);border:1px solid var(--line2);border-radius:7px;padding:4px 6px"></div>
    <div class="sl" style="grid-template-columns:150px 1fr"><span>月予算（円）</span><input type="number" id="gB" value="${GOV.budget}" style="background:#0c1430;color:var(--tx);border:1px solid var(--line2);border-radius:7px;padding:4px 6px"></div>
    <div class="sl" style="grid-template-columns:150px 1fr"><span>月間タスク数</span><input type="number" id="gT" value="${GOV.perMonth}" style="background:#0c1430;color:var(--tx);border:1px solid var(--line2);border-radius:7px;padding:4px 6px"></div>
    <div style="font-size:10.5px;color:var(--tx3)">※単価はサンプル値です。実際の料金は契約内容・各社の最新価格表で確認してください。</div>`}
function bindCost(){[['gP','price'],['gB','budget'],['gT','perMonth']].forEach(([id,k])=>$('#'+id).addEventListener('change',e=>{GOV[k]=+e.target.value||0;$('#gCost').innerHTML=costHTML();bindCost()}))}
function polHTML(){const AG=A.AG;const row=(ic,n,state,key,locked,note)=>`<div class="pol">${icon(ic)}<span>${n}</span><span class="pk">${note?`<span>${note}</span>`:''}${locked?icon('lock'):''}<span class="sw2 ${state?'on':''} ${locked?'dis':''}" ${key?`data-pol="${key}"`:''}></span></span></div>`;
  return`<div style="font-size:11px;color:var(--tx3);margin:2px 0 4px">computer use（画面操作）</div>`+row('hand','クリック',1,null,1,'必須')+row('drag','ドラッグ（視点回転）',A.POLICY.drag,'drag')+row('zoom','スクロール（ズーム）',A.POLICY.scroll,'scroll')+row('camera','スクリーンショット取得',A.POLICY.screenshot,'screenshot')+
  `<div style="font-size:11px;color:var(--tx3);margin:10px 0 4px">業務関数・禁止事項</div>`+row('api','業務計算関数（体積・偏差・離隔 等）',1,null,1,'許可リスト')+row('send','外部への送信',0,null,1,'禁止')+row('design','設計データの改変',0,null,1,'禁止')+row('mask','個人を特定できる情報の送信',0,null,1,'禁止')+
  `<div style="font-size:11px;color:var(--tx3);margin:10px 0 4px">人の承認（Human-in-the-Loop）</div>`+row('shield','確定・提出・作業停止の前に人間承認',AG.hitl,'hitl',0,AG.hitl?'':'<span style="color:var(--am)">デモ用にOFF</span>')}
function bindPol(){$$('#gPol [data-pol]').forEach(e=>e.addEventListener('click',()=>{const k=e.dataset.pol;if(k==='hitl'){$('#hitlSw').click()}else{A.POLICY[k]=!A.POLICY[k];A.audit('HUMAN','POLICY',`${k} を ${A.POLICY[k]?'許可':'拒否'} に変更`);toast(`ポリシー更新：${k} = ${A.POLICY[k]?'許可':'拒否'}（AIエージェントに即時反映）`,'shield',A.POLICY[k]?'#3ee07f':'#ff5d6c')}$('#gPol').innerHTML=polHTML();bindPol()}))}
function privHTML(){const st=C.ST.privacy;return`<div class="pol">${icon('mask')}<span>人物の自動匿名化（画素段階でぼかし）</span><span class="pk"><span class="sw2 ${st?'on':''}" id="gPriv"></span></span></div>
  <div class="pol">${icon('lock')}<span>個人の評価・監視への利用禁止</span><span class="pk">${icon('lock')}<span class="sw2 on dis"></span></span></div>
  <div class="pol">${icon('calendar')}<span>撮影データの保存期間</span><span class="pk"><select id="gRet" style="background:#0c1430;color:var(--tx);border:1px solid var(--line2);border-radius:7px;padding:3px 6px">${['工期終了＋1年','工期終了＋5年','工期終了＋10年'].map(v=>`<option ${v===GOV.retention?'selected':''}>${v}</option>`).join('')}</select></span></div>
  <div class="note" style="margin-top:10px">${icon('users')} 利用目的（安全確保・品質記録）を現場で掲示し、労使で合意した範囲で運用します。AIには匿名IDと位置だけを渡します。</div>`}
function bindPriv(){$('#gPriv').addEventListener('click',()=>{$('#privToggle').click();$('#gPrivBox').innerHTML=privHTML();bindPriv()});$('#gRet').addEventListener('change',e=>{GOV.retention=e.target.value;A.audit('HUMAN','CONFIG','保存期間 → '+GOV.retention)})}
function routeHTML(){return['claude','openai','coop'].map(m=>`<button class="ritem ${A.AG.model===m?'on':''}" data-route="${m}" style="--c:${m==='claude'?'#f0956a':m==='openai'?'#36d6ad':'#8b7bff'}"><span class="ri">${icon(m==='claude'?'mA':m==='openai'?'mB':'link','i')}</span><span><b>${m==='claude'?'Claude':m==='openai'?'OpenAI':'協調（役割分担）'}</b><small>${esc(A.MODEL_INFO[m])}</small></span><svg class="i sm ok"><use href="#i-checkc"/></svg></button>`).join('')}
function bindRoute(){$$('[data-route]').forEach(b=>b.addEventListener('click',()=>{if(A.AG.running){toast('実行中は変更できません','lock','#ffb547');return}$(`#modelSeg [data-m="${b.dataset.route}"]`).click();$('#gRoute').innerHTML=routeHTML();bindRoute()}))}
function verifyChain(){const L=A.AUD;let prev='GENESIS';for(let i=0;i<L.length;i++){const{hash,...rest}=L[i];if(rest.prev!==prev||A.fnv(JSON.stringify(rest))!==hash)return i;prev=hash}return -1}
function audHTML(){const L=A.AUD.slice(-36);return`<table class="tbl" id="audTbl"><thead><tr><th>#</th><th>時刻</th><th>主体</th><th>種別</th><th>内容</th><th>ハッシュ（前 → 自）</th></tr></thead><tbody>${L.map(e=>`<tr data-seq="${e.seq}"><td class="mono">${e.seq}</td><td class="mono">${hm(e.ts)}</td><td style="font-size:11px">${esc(e.actor)}</td><td class="mono">${esc(e.type)}</td><td style="font-size:11px;max-width:300px">${esc(e.detail)}</td><td class="mono">${e.prev.slice(0,6)}… → ${e.hash.slice(0,8)}…</td></tr>`).join('')}</tbody></table>`}
async function runVerify(){const res=$('#chainRes');const rows=$$('#audTbl tbody tr');rows.forEach(r=>r.className='');res.innerHTML=`<span style="color:var(--cy)">${icon('refresh')} 検証中…</span>`;const bad=verifyChain();
  for(const r of rows){const s=+r.dataset.seq;r.className=bad>=0&&s>=bad+1?'ng':'ok';await new Promise(x=>setTimeout(x,35))}
  res.innerHTML=bad<0?`<span style="color:var(--gr)">${icon('checkc')} チェーン検証OK：${A.AUD.length} 件すべて整合（改ざんなし）</span>`:`<span style="color:var(--rd)">${icon('alert')} 改ざんを検知：#${bad+1} でハッシュ不整合（以降のチェーンも無効）</span>`;
  A.audit('HUMAN','CHAIN_VERIFY',bad<0?'OK':'NG #'+(bad+1));}
const GW={nodes:null};
function gwSVG(){return`<defs><marker id="gah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#6c7ba4"/></marker></defs>
  <path id="gpB" class="gp" d="M170 130 H262" stroke="#38e1ff" stroke-width="2" fill="none" marker-end="url(#gah)"/><path id="gpC" class="gp" d="M478 112 C530 112 530 62 580 62" stroke="#f0956a" stroke-width="2" fill="none" marker-end="url(#gah)"/><path id="gpO" class="gp" d="M478 148 C530 148 530 198 580 198" stroke="#36d6ad" stroke-width="2" fill="none" marker-end="url(#gah)"/>
  <g class="gn"><rect x="14" y="98" width="156" height="64" rx="12" stroke="#38e1ff"/><use href="#i-cube" x="26" y="118" width="22" height="22" stroke="#38e1ff" fill="none" stroke-width="1.8"/><text x="56" y="126">Web画面（ブラウザ）</text><text class="s" x="56" y="144">キーは持たない</text></g>
  <g class="gn"><rect x="264" y="40" width="214" height="180" rx="14" stroke="#3ee07f" style="filter:drop-shadow(0 0 8px rgba(62,224,127,.3))"/><use href="#i-shield" x="278" y="52" width="22" height="22" stroke="#3ee07f" fill="none" stroke-width="1.8"/><text x="306" y="68">社内AIゲートウェイ</text>
    ${[['lock','Entra ID SSO・ロール確認',92],['mask','DLP・匿名化チェック',120],['gauge','レート制限・予算上限',148],['list','監査ログ（ハッシュ連鎖）',176],['key','APIキー保管（Vault）',204]].map(([ic,t,y])=>`<use href="#i-${ic}" x="282" y="${y-12}" width="15" height="15" stroke="#9fb0d8" fill="none" stroke-width="1.8"/><text class="s" x="304" y="${y}">${t}</text>`).join('')}</g>
  <g class="gn"><rect x="582" y="30" width="168" height="64" rx="12" stroke="#f0956a"/><use href="#i-mA" x="594" y="50" width="22" height="22" stroke="#f0956a" fill="none" stroke-width="1.8"/><text x="624" y="58">Claude API</text><text class="s" x="624" y="76">Messages・tool use</text></g>
  <g class="gn"><rect x="582" y="166" width="168" height="64" rx="12" stroke="#36d6ad"/><use href="#i-mB" x="594" y="186" width="22" height="22" stroke="#36d6ad" fill="none" stroke-width="1.8"/><text x="624" y="194">OpenAI API</text><text class="s" x="624" y="212">Responses・tools</text></g><g id="gpk"></g>`}
function packet(model,blocked,label){if(page!=='governance')return;const svg=$('#gwSvg');if(!svg)return;const g=$('#gpk');const col=blocked?'#ff5d6c':model==='claude'?'#f0956a':'#36d6ad';const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('r','6');c.setAttribute('fill',col);c.style.filter=`drop-shadow(0 0 6px ${col})`;g.appendChild(c);
  const t=document.createElementNS('http://www.w3.org/2000/svg','text');t.setAttribute('fill',col);t.setAttribute('font-size','10');t.setAttribute('font-family','monospace');t.textContent=blocked?(label||''):'';g.appendChild(t);
  const p1=$('#gpB'),p2=blocked?null:$(model==='claude'?'#gpC':'#gpO');const L1=p1.getTotalLength(),L2=p2?p2.getTotalLength():0;const t0=performance.now();
  const st=()=>{const e=(performance.now()-t0)/1;let pt;if(e<600){pt=p1.getPointAtLength(L1*e/600)}else if(e<1000){pt={x:300+(e-600)/400*140,y:130}}else if(blocked){pt={x:440+Math.sin(e/30)*4,y:130};c.setAttribute('r',6+(e-1000)/80);c.setAttribute('opacity',Math.max(0,1-(e-1000)/700))}else if(e<1700){pt=p2.getPointAtLength(L2*(e-1000)/700)}else{pt=p2.getPointAtLength(L2);c.setAttribute('r',6+(e-1700)/60);c.setAttribute('opacity',Math.max(0,1-(e-1700)/500))}
    c.setAttribute('cx',pt.x);c.setAttribute('cy',pt.y);t.setAttribute('x',pt.x+9);t.setAttribute('y',pt.y-8);if(e>(blocked?1700:2200)){c.remove();t.remove();return}requestAnimationFrame(st)};st();
  if(blocked){const x=document.createElementNS('http://www.w3.org/2000/svg','text');x.setAttribute('x',428);x.setAttribute('y',100);x.setAttribute('fill','#ff5d6c');x.setAttribute('font-size','13');x.setAttribute('font-weight','700');x.textContent='✕ DENY';g.appendChild(x);setTimeout(()=>x.remove(),1800)}}
SAS.on('api',e=>{S.api++;if(e.blocked)S.blocked++;S.tok+=e.tokens||0;S.log.push({...e,t:new Date()});if(S.log.length>300)S.log.shift();packet(e.model,e.blocked,e.name);if(page==='governance'&&P.governance._init){$('#gLog').innerHTML=apiLogHTML();$('#gCost').innerHTML=costHTML();bindCost()}});
P.governance={init(){
  $('#pg-governance').innerHTML=`<div class="pg-h" style="--c:#3ee07f"><div class="pi">${icon('lock','i lg')}</div><div><h2>統制 ─ AIゲートウェイ・ポリシー・監査</h2><p>IT・DX部門向け。APIキーはゲートウェイで保持し、ロール・操作の許可・人の承認・匿名化・費用・監査ログを一元管理します。ここでの変更はAIエージェントに即時反映されます。</p></div><div class="act"><button class="hbtn" id="gTest">${icon('send')}テスト送信</button><button class="hbtn" id="gDeny" style="border-color:rgba(255,93,108,.6)">${icon('alert')}ポリシー違反をテスト</button></div></div>
  <div class="g" style="grid-template-columns:1.5fr 1fr"><div class="card glow" style="--c:var(--gr)"><h3>${icon('flow')}AIゲートウェイの流れ<span class="r live"><i></i>呼び出しごとにパケット表示</span></h3><svg id="gwSvg" viewBox="0 0 760 250">${gwSVG()}</svg></div>
    <div class="card"><h3>${icon('yen')}利用量と費用<span class="r">推定</span></h3><div id="gCost"></div></div></div>
  <div class="g g3 mt"><div class="card"><h3>${icon('shield')}操作の許可リスト（ポリシー）</h3><div id="gPol"></div></div>
    <div class="card"><h3>${icon('mask')}プライバシー・人権配慮</h3><div id="gPrivBox"></div><h3 class="mt">${icon('spark')}モデルの割り当て（全社既定）</h3><div id="gRoute"></div></div>
    <div class="card"><h3>${icon('users')}ロール別の権限（RBAC）</h3><table class="tbl rbac"><thead><tr><th>権限</th><th>担当</th><th>代理人</th><th>本社</th><th>IT</th></tr></thead><tbody>
      ${[['3Dビュー閲覧・計測','y','y','y','y'],['AIタスクの実行','y','y','y','y'],['撮影データのアップロード','y','n','n','y'],['承認（確定・提出・停止）','n','y','n','n'],['連携・保存先の操作','n','y','y','y'],['ポリシー・ゲートウェイ設定','n','n','n','y'],['監査ログの閲覧','n','q','q','y']].map(r=>`<tr><td>${r[0]}</td>${r.slice(1).map(v=>`<td class="${v}">${v==='y'?icon('checkc'):v==='q'?icon('shield'):icon('x')}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <div style="font-size:10.5px;color:var(--tx3);margin-top:6px">${icon('shield')} = 自現場のみ／申請制　｜　Entra IDのセキュリティグループで割り当て（模擬）</div></div></div>
  <div class="g mt" style="grid-template-columns:1fr 1.4fr"><div class="card"><h3>${icon('api')}API呼び出しログ（ゲートウェイ）</h3><div id="gLog" style="max-height:380px;overflow:auto"></div></div>
    <div class="card"><h3>${icon('link')}監査ログ ─ ハッシュ連鎖の検証<span class="r"><button class="mini" id="chV">${icon('shield')}チェーン検証</button><button class="mini" id="chT" style="border-color:rgba(255,93,108,.5)">${icon('alert')}改ざんを試す</button></span></h3><div id="chainRes" style="font-size:12px;margin-bottom:8px">各記録は直前の記録のハッシュを含むため、1件でも書き換えると以降が不整合になります（J-SOX・ISO 27001 の証跡向け）。</div><div id="gAud" style="max-height:380px;overflow:auto"></div></div></div>`;
  $('#gTest').addEventListener('click',async()=>{for(const [m,k,n] of [['claude','message','messages'],['openai','computer','screenshot'],['claude','function','compute_deviation']]){SAS.emit('api',{model:m,kind:k,name:n,tokens:200,test:true});await new Promise(r=>setTimeout(r,450))}});
  $('#gDeny').addEventListener('click',()=>{SAS.emit('api',{model:'openai',kind:'computer',name:'外部送信 POST https://example.com',blocked:true,tokens:0,test:true});A.audit('GATEWAY','DENY','外部送信をポリシーで拒否（テスト）');toast('ゲートウェイが外部送信を拒否しました（テスト）','lock','#ff5d6c')});
  $('#chV').addEventListener('click',runVerify);
  $('#chT').addEventListener('click',()=>{const L=A.AUD;if(GOV.tampered){const e=L.find(x=>x.seq===GOV.tampered.seq);if(e)e.detail=GOV.tampered.orig;GOV.tampered=null;$('#chT').innerHTML=icon('alert')+'改ざんを試す';toast('改ざんを元に戻しました','refresh','#3ee07f')}
    else{if(L.length<2){toast('監査ログが少ないため、先にAIタスクや操作を行ってください','info','#9fb0d8');return}const e=L[Math.max(0,L.length-Math.min(12,L.length-1)-1)];GOV.tampered={seq:e.seq,orig:e.detail};e.detail=e.detail+'（※書き換え）';$('#chT').innerHTML=icon('refresh')+'元に戻す';toast(`監査ログ #${e.seq} の内容を書き換えました → 「チェーン検証」で検知できます`,'alert','#ff5d6c',4200)}$('#gAud').innerHTML=audHTML()});
},refresh(){$('#gCost').innerHTML=costHTML();bindCost();$('#gPol').innerHTML=polHTML();bindPol();$('#gPrivBox').innerHTML=privHTML();bindPriv();$('#gRoute').innerHTML=routeHTML();bindRoute();$('#gLog').innerHTML=apiLogHTML();$('#gAud').innerHTML=audHTML()}};
SAS.on('task',t=>{if(t.state==='done'){S.tasks++;S.taskTok+=t.tok||0;S.types[t.key]=(S.types[t.key]||0)+1}});
SAS.on('alert',()=>{S.alerts++});

/* =========================================================
   ARCHITECTURE (7 layers)
   ========================================================= */
const LAYERS7=[
  {n:'現場データの取得',ic:'drone',c:'#38e1ff',d:'ドローン・360°カメラ・地上LiDARで定期撮影し、GPUサーバで3DGSを自動生成',t:['ドローン','360°カメラ','LiDAR','RTK-GNSS','GPUサーバ'],role:'撮影データを集めて3DGS化し、日付ごとの版として保管する入口。',smp:'「データ取得」画面：アップロード → 6段階の処理 → 新しい版の登録を模擬。',prod:['撮影頻度・処理範囲でGPU費用が決まる（費用試算あり）','標定点（GCP）とRTKで位置精度を確保','人が写る場合は撮影の告知と匿名化']},
  {n:'3Dデータ基盤',ic:'db',c:'#8b7bff',d:'3DGS・点群・設計データを同じ座標で重ね合わせ、版とアクセス権を管理',t:['3DGS','LAS/LAZ','LandXML','IFC','版管理','RBAC'],role:'すべての3Dデータの「正本」。座標・版・権限・ハッシュを一元管理。',smp:'「3D基盤」画面と、3Dビュー下部の4D版バー（10/02〜最新）。',prod:['座標系・標高基準の統一','数百MB〜GB級ファイルのストレージ・転送設計','現場×ロールのアクセス制御']},
  {n:'WebGPUビューア',ic:'gpu',c:'#38e1ff',d:'大きな3DGSをブラウザで軽快に表示。人とAIが同じ計測ツールを使う',t:['WebGPU','WGSL','インスタンス描画','Canvas2D代替'],role:'人とAIが共有する「作業台」。専用ソフト不要。',smp:'約1.3万スプラットをWGSLで描画。距離・面積・土量・断面・ヒートマップ・注記・危険域・撮影。',prod:['数百万スプラットはLOD・ストリーミング・GPUソートが必要','社内PCのGPU・ブラウザ要件の確認']},
  {n:'AIエージェント基盤',ic:'brain',c:'#f0956a',d:'Claude／OpenAIを社内AIゲートウェイ経由で呼び出し、計画・操作・検証を行う',t:['Claude API','OpenAI API','computer use','function calling','AIゲートウェイ'],role:'画面を「見て」理解し、UIツールを操作して業務を進める頭脳。',smp:'模擬：知覚→推論→操作→検証のループ、両社のツール呼び出し形式、協調モード。',prod:['APIキーはゲートウェイ側で保持','DLP・レート制限・予算上限','モデル更新時の回帰テスト']},
  {n:'業務計算エンジン',ic:'volume',c:'#ffb547',d:'出来形差分・土量・離隔監視・変状検出。数値は必ず決まった手順で計算',t:['出来形差分','土量グリッド積分','離隔監視','変状検出'],role:'数値の「正しさ」の担い手。AIは手順の判断と操作だけを担当し、数値を作らない。',smp:'偏差・体積・距離・延長はモデルから毎回計算（AIの出力に依存しない）。',prod:['計算ロジックの検証記録（品質保証）','発注者基準・社内基準のパラメータ化']},
  {n:'ガバナンス',ic:'shield',c:'#3ee07f',d:'SSO・ロール権限・操作の許可リスト・人の承認・改ざん検知ログ・匿名化',t:['Entra ID SSO','RBAC','許可リスト','HITL承認','ハッシュ連鎖','匿名化'],role:'AIに「やってよいこと」と「人が決めること」を分ける安全装置。',smp:'「統制」画面：ポリシー即時反映、チェーン検証と改ざん検知、ロール切替で承認権限が変化。',prod:['J-SOX・ISO 27001の証跡要件との整合','匿名化と利用目的について労使で合意']},
  {n:'他システムとの連携',ic:'link',c:'#ff7ad9',d:'Teams通知・帳票出力・DirectCloud／SharePoint保存・施工管理/原価連携',t:['Teams','Word/PDF','DirectCloud','SharePoint','施工管理・原価'],role:'結果を既存の業務・システムに届ける出口。',smp:'「連携」画面：通知カード、定期実行、保存同期、原価連携を模擬（外部送信なし）。',prod:['各システムのAPI・権限設計','通知の出しすぎ防止（重要度の設計）']}];
let selL=3;
function ldet(i){const L=LAYERS7[i];return`<div class="ldet" style="--c:${L.c}"><h4 style="color:${L.c}">${icon(L.ic,'i lg')}<span style="color:var(--tx)">第${i+1}層　${L.n}</span></h4><dl><dt>役割</dt><dd>${L.role}</dd><dt>主な技術</dt><dd style="display:flex;flex-wrap:wrap;gap:5px">${L.t.map(x=>`<span class="pill" style="--c:${L.c}">${x}</span>`).join('')}</dd><dt>このサンプル</dt><dd>${L.smp}</dd><dt>本番での考慮</dt><dd><ul>${L.prod.map(x=>`<li>${x}</li>`).join('')}</ul></dd></dl></div>`}
P.arch={init(){
  $('#archBody').innerHTML=`<div class="g" style="grid-template-columns:1.3fr 1fr"><div class="card"><h3>${icon('layers')}7層の構成<span class="r">下から上へデータが流れます</span></h3><div class="layers7" id="ly7"><i class="pk7"></i><i class="pk7" style="animation-delay:1.3s"></i><i class="pk7" style="animation-delay:2.6s"></i>${LAYERS7.map((L,i)=>`<button class="ly ${i===selL?'on':''}" data-l="${i}" style="--c:${L.c};animation-delay:${(6-i)*0.07}s"><span class="ln">${i+1}</span><span class="lic">${icon(L.ic,'i')}</span><span style="min-width:0"><b>${L.n}</b><small>${L.d}</small></span><span class="tch">${L.t.slice(0,3).map(x=>`<span>${x}</span>`).join('')}</span></button>`).join('')}</div></div>
    <div class="card glow" id="ldet" style="--c:${LAYERS7[selL].c}">${ldet(selL)}</div></div>
  <div class="card mt"><h3>${icon('users')}誰がどう使うか<span class="r">業務の流れ</span></h3><div class="uflow">${[['drone','撮影','#38e1ff'],['splat','3D化','#8b7bff'],['spark','AIが下書き','#f0956a'],['shield','確認・承認','#3ee07f'],['link','連携・保管','#ff7ad9']].map(([ic,n,c],i)=>(i?`<span class="ua">${icon('arrow')}</span>`:'')+`<span class="uf" style="--c:${c};--d:${i}s">${icon(ic)}${n}</span>`).join('')}</div>
    <div class="swim mt">${Object.values(A.ROLE.defs).map((d,i)=>`<div class="swl" style="--c:${d.c};animation-delay:${i*0.08}s"><div class="sh"><span>${icon(d.ic)}</span>${d.n}</div><ul>${d.can.map(c=>`<li>${c}</li>`).join('')}</ul></div>`).join('')}</div></div>`;
  $$('#ly7 .ly').forEach(b=>b.addEventListener('click',()=>{selL=+b.dataset.l;$$('#ly7 .ly').forEach(x=>x.classList.toggle('on',x===b));const d=$('#ldet');d.style.setProperty('--c',LAYERS7[selL].c);d.innerHTML=ldet(selL)}));
  $('#btnApi2').addEventListener('click',()=>$('#btnApi').click());
}};

/* =========================================================
   ROADMAP
   ========================================================= */
const PHASES=[
  {t:'Phase 0',n:'構想共有・PoC',p:'いま',c:'#ff7ad9',g:['本サンプル（完全オフライン）で関係者の合意形成','対象業務・対象現場の候補出し'],x:['対象業務と現場の決定','予算・体制の合意']},
  {t:'Phase 1',n:'1現場でビューア＋手動ツール',p:'目安 約3か月',c:'#38e1ff',g:['撮影→3D化の運用を固める','計測ツールを現場で試行'],x:['撮影から公開までの日数が安定','LiDAR・TSとの精度比較を記録']},
  {t:'Phase 2',n:'AIが計測・集計・下書き',p:'目安 約3か月',c:'#f0956a',g:['社内AIゲートウェイの構築','確定は必ず人が承認'],x:['下書きの採用率','誤り・手戻りの評価']},
  {t:'Phase 3',n:'Teams連携・帳票・複数現場へ展開',p:'目安 約6か月',c:'#3ee07f',g:['通知・帳票出力・保存の自動化','3〜5現場へ展開'],x:['削減時間の実測','運用手順書・教育']},
  {t:'Phase 4',n:'他システム連携・定期実行',p:'継続',c:'#ffb547',g:['施工管理・原価システム連携','毎朝の自動点検レポート'],x:['全社標準化','費用対効果の継続評価']}];
const EFF=[['出来形帳票の作成',16,4],['土量集計・運搬計画',10,2.5],['安全パトロール記録',12,6],['護岸・構造物の点検調書',14,5],['3Dデータの整理・共有',8,2]];
const CAV=[
  {ic:'target',c:'#38e1ff',n:'3DGSの精度',p:'3DGSは「見せる」のが得意な技術で、発注者に出す正式な出来形計測には精度の保証が足りない場合があります。',m:'正式な計測はLiDAR点群・TSと組み合わせ、3DGSは可視化と一次チェックに位置づける。'},
  {ic:'hand',c:'#ffb547',n:'AIの誤操作',p:'画面操作（computer use）はクリック位置のずれ等で誤操作する可能性があります。',m:'重要な計算は業務関数を直接呼び、画面操作は経過の可視化・補助に限定。確定は人が承認。'},
  {ic:'yen',c:'#ff7ad9',n:'費用',p:'GPU処理（3DGS生成）とAPIのトークン費用が継続的にかかります。',m:'撮影頻度・処理範囲で調整できる設計に。ゲートウェイで予算上限とレート制限を設定。'},
  {ic:'mask',c:'#8b7bff',n:'労務・人権面',p:'人が写る撮影データは、個人の監視・評価につながる懸念があります。',m:'自動匿名化と利用目的の明示。個人評価に使わないことを規程化し、労使で合意。'},
  {ic:'report',c:'#3ee07f',n:'基準との整合',p:'発注者の出来形管理要領や社内基準と、判定方法・規格値を合わせる必要があります。',m:'判定基準・規格値を設定で変えられるようにし、計算ロジックの検証記録を残す。'}];
P.roadmap={init(){
  $('#pg-roadmap').innerHTML=`<div class="pg-h" style="--c:#ff7ad9"><div class="pi">${icon('flag','i lg')}</div><div><h2>導入計画・期待効果・注意点</h2><p>小さく始めて、精度と運用を確かめながら広げます。期間・効果の数値は目安（サンプル）です。</p></div></div>
  <div class="card glow" style="--c:var(--pk)"><h3>${icon('flag')}導入ステップ</h3><div class="road"><div class="rl"><i id="rlBar"></i><em id="rlNow">いまここ</em></div>${PHASES.map((p,i)=>`<div class="phs ${i===0?'cur':''}" style="--c:${p.c};animation-delay:${i*0.1}s"><span class="pdot"></span><div class="pt">${p.t}</div><b>${p.n}</b><div class="pp">${icon('clock')} ${p.p}</div><h5>${icon('target')}やること</h5><ul>${p.g.map(x=>`<li>${x}</li>`).join('')}</ul><h5>${icon('checkc')}次へ進む条件</h5><ul>${p.x.map(x=>`<li>${x}</li>`).join('')}</ul></div>`).join('')}</div></div>
  <div class="g mt" style="grid-template-columns:1fr 1.15fr"><div class="card"><h3>${icon('chart')}期待効果（1現場・月あたり・試算）<span class="r"><i style="display:inline-block;width:10px;height:6px;background:rgba(159,176,216,.45);border-radius:3px"></i>現在 <i style="display:inline-block;width:10px;height:6px;background:var(--gr);border-radius:3px;margin-left:6px"></i>導入後</span></h3><div id="effs"></div>
      <div class="stat mt" style="display:flex;align-items:center;gap:14px"><span style="color:var(--gr)">${icon('clock','i xl')}</span><div><small>合計の削減（試算）</small><b class="bigv" id="effSum">0</b><span style="font-size:12px;color:var(--tx2)"> 時間/月・現場</span></div></div>
      <div style="font-size:10.5px;color:var(--tx3);margin-top:8px">※効果はサンプルの仮定値です。Phase 1〜2で実測して置き換えてください。浮いた時間は判断・対策・品質向上に充てる想定です。</div></div>
    <div class="card"><h3>${icon('alert')}注意点・課題と対策</h3><div class="g" style="gap:9px">${CAV.map((c,i)=>`<div class="cv" style="--c:${c.c};animation-delay:${i*0.08}s"><span class="cvi">${icon(c.ic,'i')}</span><div><b>${c.n}</b><p>${c.p}</p><div class="mit">${icon('shield')}<span>${c.m}</span></div></div></div>`).join('')}</div></div></div>`;
},refresh(){
  const mx=Math.max(...EFF.map(e=>e[1]));$('#effs').innerHTML=EFF.map(([n,b,a])=>`<div class="eff"><span>${n}</span><div class="bars"><i class="b" data-w="${b/mx*100}"></i><i class="a" data-w="${a/mx*100}"></i></div><span class="v">${b}h → <b>${a}h</b></span></div>`).join('');
  requestAnimationFrame(()=>requestAnimationFrame(()=>{$$('#effs i').forEach(i=>i.style.width=i.dataset.w+'%');$('#rlBar').style.width='6.5%';$('#rlNow').style.left='6.5%'}));
  countUp($('#effSum'),EFF.reduce((s,e)=>s+e[1]-e[2],0),1);
}};

/* =========================================================
   Thumbnails loop & boot
   ========================================================= */
const tloop=t=>{if(page==='dash'&&thumbs.length)drawThumbs(t/1000);requestAnimationFrame(tloop)};requestAnimationFrame(tloop);
document.body.dataset.page='viewer';refreshNav();badge();
SAS.on('ready',()=>{refreshNav();goto('dash')});
SAS.on('report',()=>{if(page==='integration')P.integration.refresh()});
Object.assign(window.__SAS_APP,{SITES,APS,P,goto,decide,getPage:()=>page});
})();
