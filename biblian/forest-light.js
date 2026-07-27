/* BIBLIAN — <forest-light> 숲의 빛 애니메이션 커스텀 엘리먼트
   image-slot.js 와 같은 패턴: dc-runtime 이 DOM 을 다시 그려도
   connectedCallback / disconnectedCallback 으로 항상 살아난다. */
(function(){
  if(customElements.get('forest-light'))return;

  class ForestLight extends HTMLElement{
    connectedCallback(){
      if(!this.__cv){
        this.style.display='block';
        this.style.pointerEvents='none';
        const cv=document.createElement('canvas');
        cv.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block';
        this.appendChild(cv);
        this.__cv=cv;
        this.__cx=cv.getContext('2d');
        /* 보케 빛망울 */
        this.__P=Array.from({length:26},()=>({
          x:Math.random(),y:.1+Math.random()*.95,
          r:.007+Math.random()*.032,
          sp:.00003+Math.random()*.00006,
          ph:Math.random()*6.28,sw:.00008+Math.random()*.00012}));
        /* 공기 입자 */
        this.__dust=Array.from({length:34},()=>({
          x:Math.random(),y:Math.random(),
          sp:.00002+Math.random()*.00005,
          ph:Math.random()*6.28}));
        this.__rm=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
        this.__ro=new ResizeObserver(()=>{
          this.__resize();
          if(this.__rm)this.__frame(0,true);
        });
      }
      this.__ro.observe(this);
      this.__resize();
      this.__run=true;
      if(this.__rm){this.__frame(0,true);return;}
      const loop=()=>{
        if(!this.__run)return;
        this.__frame(performance.now(),false);
        requestAnimationFrame(loop);
      };
      loop();
    }

    disconnectedCallback(){
      this.__run=false;
      if(this.__ro)this.__ro.disconnect();
    }

    __resize(){
      const cv=this.__cv;
      cv.width=this.offsetWidth||0;
      cv.height=this.offsetHeight||0;
    }

    __frame(t,still){
      const cv=this.__cv,cx=this.__cx;
      const W=cv.width,H=cv.height;
      if(!W||!H)return;
      cx.clearRect(0,0,W,H);

      /* ── 공기 안개층 ── */
      const hz=cx.createLinearGradient(0,0,0,H);
      hz.addColorStop(0,'rgba(230,248,232,.10)');
      hz.addColorStop(.45,'rgba(230,248,232,.03)');
      hz.addColorStop(1,'rgba(230,248,232,0)');
      cx.fillStyle=hz;cx.fillRect(0,0,W,H);

      /* ── 빛줄기 1 ── */
      const ra=still?.12:.11+.05*Math.sin(t/4800);
      const g1=cx.createLinearGradient(W*.55,0,W*.2,H);
      g1.addColorStop(0,'rgba(255,250,215,'+ra+')');
      g1.addColorStop(.7,'rgba(255,250,215,'+(ra*.3)+')');
      g1.addColorStop(1,'rgba(255,250,215,0)');
      cx.beginPath();
      cx.moveTo(W*.40,-10);cx.lineTo(W*.64,-10);
      cx.lineTo(W*.34,H);cx.lineTo(W*.04,H);cx.closePath();
      cx.fillStyle=g1;cx.fill();

      /* ── 빛줄기 2 ── */
      const rb=still?.09:.085+.04*Math.sin(t/5700+2);
      const g2=cx.createLinearGradient(W*.85,0,W*.55,H);
      g2.addColorStop(0,'rgba(238,255,232,'+rb+')');
      g2.addColorStop(.7,'rgba(238,255,232,'+(rb*.3)+')');
      g2.addColorStop(1,'rgba(238,255,232,0)');
      cx.beginPath();
      cx.moveTo(W*.72,-10);cx.lineTo(W*.88,-10);
      cx.lineTo(W*.60,H);cx.lineTo(W*.42,H);cx.closePath();
      cx.fillStyle=g2;cx.fill();

      /* ── 중심 빛심 ── */
      const rc=still?.11:.10+.05*Math.sin(t/4800);
      const g3=cx.createLinearGradient(W*.52,0,W*.30,H);
      g3.addColorStop(0,'rgba(255,255,235,'+rc+')');
      g3.addColorStop(1,'rgba(255,255,235,0)');
      cx.beginPath();
      cx.moveTo(W*.49,-10);cx.lineTo(W*.55,-10);
      cx.lineTo(W*.24,H);cx.lineTo(W*.16,H);cx.closePath();
      cx.fillStyle=g3;cx.fill();

      if(still)return;

      /* ── 미세 먼지 입자 — 공기의 결 ── */
      for(const p of this.__dust){
        p.y-=p.sp*55;
        p.x+=Math.sin(t/3200+p.ph)*.00012;
        if(p.y<-.03){p.y=1.03;p.x=Math.random();}
        const a=.28+.22*Math.sin(t/1300+p.ph);
        if(a<=0)continue;
        cx.beginPath();cx.arc(p.x*W,p.y*H,1.1,0,Math.PI*2);
        cx.fillStyle='rgba(255,255,245,'+a+')';cx.fill();
      }

      /* ── 보케 빛망울 ── */
      for(const p of this.__P){
        p.y-=p.sp*60;
        p.x+=Math.sin(t/3800+p.ph)*p.sw;
        if(p.y<-.07){p.y=1.06;p.x=Math.random();}
        const a=.22+.16*Math.sin(t/1600+p.ph);
        if(a<=0)continue;
        const x=p.x*W,y=p.y*H,r=Math.max(2,p.r*W);
        const g=cx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0,'rgba(255,255,242,'+a+')');
        g.addColorStop(.45,'rgba(230,252,235,'+(a*.65)+')');
        g.addColorStop(1,'rgba(230,252,235,0)');
        cx.beginPath();cx.arc(x,y,r,0,Math.PI*2);cx.fillStyle=g;cx.fill();
        cx.beginPath();cx.arc(x,y,r*.72,0,Math.PI*2);
        cx.strokeStyle='rgba(255,255,248,'+(a*.5)+')';
        cx.lineWidth=1;cx.stroke();
      }
    }
  }

  customElements.define('forest-light',ForestLight);
})();
