import * as THREE from 'three';
import { entrance, rampHeightAt, routes, type Point3 } from './layout';
import { createCityContext } from './city-context';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type ZoneIndex = 0 | 1 | 2 | 3;
type Pose = { position: THREE.Vector3; target: THREE.Vector3; span: number };
const BRAND = 0x12372a;
const poses: Pose[] = [
  { position: new THREE.Vector3(18, 17, 24), target: new THREE.Vector3(-.7, .8, .3), span: 33 },
  { position: new THREE.Vector3(9, 8, 19), target: new THREE.Vector3(-1.5, 1, 4.2), span: 12.5 },
  { position: new THREE.Vector3(12, 18, 19), target: new THREE.Vector3(-1.1, .7, -.4), span: 13.3 },
  { position: new THREE.Vector3(11, 14, 13), target: new THREE.Vector3(3, .8, -1.7), span: 7.3 },
];

export class BuildingScene {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();
  private renderer: THREE.WebGLRenderer;
  private root = new THREE.Group();
  private roof = new THREE.Group();
  private facade = new THREE.Group();
  private facadeMaterials: THREE.Material[] = [];
  private patches: THREE.Mesh[] = [];
  private routeMeshes: THREE.InstancedMesh[] = [];
  private weights = [1, 0, 0, 0];
  private initialized = false;
  readonly ready: Promise<void>;
  private resizeObserver: ResizeObserver;
  private reduce = matchMedia('(prefers-reduced-motion: reduce)');
  private frame = 0;
  private currentTarget = poses[0].target.clone();
  private span = poses[0].span;
  private cutaway = 0;
  private selected: ZoneIndex = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  private markers = [new THREE.Vector3(-7.1, .6, 3.2), new THREE.Vector3(-4.1, 1.1, 5.4), new THREE.Vector3(-4.3, 3.4, -2.3), new THREE.Vector3(4.6, 2.5, -3.4)];
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  
  private transition: { started: number; position: THREE.Vector3; target: THREE.Vector3; span: number; cutaway: number; weights: number[] } | null = null;
  onProject?: (points: { x: number; y: number; visible: boolean; opacity: number }[]) => void;
  onSettled?: () => void;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    // Native-density rendering, bounded by total framebuffer pixels in resize().
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Architecture and lights are fixed; do not redraw the shadow atlas every animation frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0xf4f4f5, 0);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.prepend(this.renderer.domElement);
    this.camera.position.copy(poses[0].position);
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9da8a0, 1.7));
    const sun = new THREE.DirectionalLight(0xfffaf1, 3.2);
    sun.position.set(-8, 18, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -23, right: 23, top: 23, bottom: -23, near: 1, far: 70 });
    sun.shadow.bias = -.0005; sun.shadow.normalBias = .045;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, .35));
    this.build();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    document.addEventListener('visibilitychange', this.visibility);
    this.reduce.addEventListener('change', this.motion);
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.resize();
    // Compile the transparent shell and every route before accepting animated frames.
    this.ready = this.renderer.compileAsync(this.scene, this.camera).then(() => {
      if (this.disposed) return;
      this.initialized = true;
      this.renderer.shadowMap.needsUpdate = true;
      this.render(performance.now());
    });
  }
  private material(color: THREE.ColorRepresentation, roughness = .8) {
    const m = new THREE.MeshStandardMaterial({ color, roughness }); this.materials.add(m); return m;
  }
  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent = this.root) {
    this.geometries.add(geometry); this.materials.add(material);
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, parent = this.root, rounded = false) {
    const geometry = rounded ? new RoundedBoxGeometry(w, h, d, 2, Math.min(.12, h / 3)) : new THREE.BoxGeometry(w, h, d);
    const mesh = this.mesh(geometry, material, parent); mesh.position.set(x, y, z); return mesh;
  }
  private cylinder(r: number, h: number, x: number, y: number, z: number, material: THREE.Material, parent = this.root) {
    const mesh = this.mesh(new THREE.CylinderGeometry(r, r, h, 20), material, parent); mesh.position.set(x, y, z); return mesh;
  }
  private rail(points: number[][], radius: number, material: THREE.Material, parent = this.root) {
    for (let i = 1; i < points.length; i++) {
      const a = new THREE.Vector3(...points[i - 1] as [number, number, number]);
      const b = new THREE.Vector3(...points[i] as [number, number, number]);
      const mesh = this.mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8), material, parent);
      mesh.position.copy(a).add(b).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    }
  }
  private ring(radius: number, x: number, y: number, z: number, color: number, opacity = .6) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const mesh = this.mesh(new THREE.RingGeometry(radius - .025, radius, 64), mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); mesh.castShadow = false; return mesh;
  }
  private tree(x: number, z: number, scale = 1) {
    const g = new THREE.Group(); this.root.add(g); g.position.set(x, .2, z); g.scale.setScalar(scale);
    this.cylinder(.12, 1.3, 0, .65, 0, this.material(0x9b8971), g);
    const leaf = this.material(0x718979);
    [[0, 1.9, 0, .85], [.4, 1.7, .2, .65], [-.4, 1.7, .1, .65], [.1, 2.35, -.1, .65]].forEach(([a,b,c,r]) => {
      const m = this.mesh(new THREE.IcosahedronGeometry(r, 2), leaf, g); m.position.set(a,b,c);
    });
    this.cylinder(.6, .13, 0, .06, 0, this.material(0xd6dbd3), g);
  }
  private route(points: Point3[], zone: number) {
    const vectors = points.map(point => new THREE.Vector3(...point));
    const path = new THREE.CurvePath<THREE.Vector3>();
    let start = vectors[0];
    for (let i = 1; i < vectors.length - 1; i++) {
      const corner = vectors[i];
      const incoming = corner.clone().sub(vectors[i - 1]);
      const outgoing = vectors[i + 1].clone().sub(corner);
      const radius = Math.min(.18, incoming.length() / 3, outgoing.length() / 3);
      const before = corner.clone().addScaledVector(incoming.normalize(), -radius);
      const after = corner.clone().addScaledVector(outgoing.normalize(), radius);
      path.add(new THREE.LineCurve3(start, before));
      path.add(new THREE.QuadraticBezierCurve3(before, corner, after));
      start = after;
    }
    path.add(new THREE.LineCurve3(start, vectors[vectors.length - 1]));
    const count = Math.ceil(path.getLength() / .22) + 1;
    const material = new THREE.MeshBasicMaterial({ color: 0x2f785b, transparent: true, opacity: 0, depthWrite: false });
    const geometry = new THREE.CylinderGeometry(.038, .038, .012, 12);
    this.geometries.add(geometry); this.materials.add(material);
    const dots = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const point = path.getPoint(i / (count - 1));
      matrix.makeTranslation(point.x, point.y, point.z);
      dots.setMatrixAt(i, matrix);
    }
    dots.instanceMatrix.needsUpdate = true;
    dots.computeBoundingSphere(); this.root.add(dots); this.routeMeshes[zone] = dots;
  }
  private build() {
    const white = this.material(0xfafbf8), wall = this.material(0xe8e9e4), floor = this.material(0xf2f0e9);
    const green = this.material(BRAND), metal = this.material(0x5e796c, .45), glass = this.material(0x96b7ad, .23);
    const stone = this.material(0xd9dcd7);
    this.box(20, .35, 18, 0, -.15, 1.5, white, this.root, true);
    const city = createCityContext(); this.root.add(city.group);
    city.materials.forEach(material => this.materials.add(material));
    city.geometries.forEach(geometry => this.geometries.add(geometry));
    this.box(10.4, .45, 8.4, 0, .26, 0, stone, this.root, true);
    this.box(10, .08, 8, 0, .52, 0, floor);
    this.box(10.2, 3.5, .23, 0, 2.3, -4, wall);
    this.box(.23, 3.5, 8, -5, 2.3, 0, wall);
    // A separate exterior shell opens for the two interior viewpoints.
    this.root.add(this.facade); this.root.add(this.roof);
    const shell = this.material(0xfafbf8); const shellGlass = this.material(0x96b7ad, .25); const shellGreen = this.material(BRAND);
    this.facadeMaterials.push(shell, shellGlass, shellGreen);
    this.box(.23, 3.5, 8, 5, 2.3, 0, shell, this.facade);
    this.box(2, 3.5, .22, -4, 2.3, 4, shell, this.facade);
    this.box(5.8, 3.5, .22, 2.1, 2.3, 4, shell, this.facade);
    this.box(2.2, .65, .22, -1.9, 3.72, 4, shell, this.facade);
    for (const x of [.5, 2.5, 4]) {
      this.box(1.15, 1.55, .06, x, 2.2, 4.13, shellGlass, this.facade);
      this.box(1.25, .08, .15, x, 1.43, 4.16, shell, this.facade);
    }
    for (const z of [-2.5, 0, 2.5]) this.box(.06, 1.55, 1.2, 5.13, 2.2, z, shellGlass, this.facade);
    // Door glazing is behind its mullion and pulls, not painted over them.
    this.box(2.05, 2.65, .13, -1.9, 1.9, 4, shellGreen, this.facade);
    for (const x of [-2.35, -1.45]) this.box(.84, 2.35, .06, x, 1.96, 4.09, shellGlass, this.facade);
    const mullion = this.box(.065, 2.45, .06, -1.9, 1.96, 4.17, shellGreen, this.facade);
    mullion.userData.shellLayer = 12;
    for (const x of [-2.08, -1.72]) {
      const pull = this.box(.055, .58, .07, x, 1.82, 4.25, shellGreen, this.facade, true);
      pull.userData.shellLayer = 12;
      for (const y of [1.58, 2.06]) {
        const bracket = this.box(.08, .045, .13, x, y, 4.19, shellGreen, this.facade);
        bracket.userData.shellLayer = 12;
      }
    }
    const sill = this.box(2.05, .055, .18, -1.9, .595, 4.13, shellGreen, this.facade);
    sill.userData.shellLayer = 12;
    // Architectural signage is graphic; small world-space text is unreadable in overview.
    this.box(.5, .18, .04, -1.9, 3.75, 4.15, shellGreen, this.facade);
    this.box(.2, .3, .08, -.65, 1.5, 4.2, shellGreen, this.facade);
    // Floating flat roof and recessed green roof garden.
    this.box(10.6, .25, 8.6, 0, 4.18, 0, shell, this.roof, true);
    this.box(9.9, .08, 7.9, 0, 4.34, 0, this.material(0xa6b8a5), this.roof);
    this.box(3, .22, 2, 2.8, 4.45, -1.4, shell, this.roof, true);
    this.box(2.7, .05, 1.7, 2.8, 4.59, -1.4, shellGlass, this.roof);
    // Shared edges and heights keep every tread attached to the landing.
    const e = entrance;
    this.box(3.5, e.landingTop - .06, 1.5, -1.9, (e.landingTop + .06) / 2, 4.75, stone);
    for (let i = 0; i < 3; i++) {
      const top = e.landingTop - (i + 1) * (e.landingTop - e.groundTop) / 4;
      this.box(e.stairWidth, top - .06, e.treadDepth, e.stairX, (top + .06) / 2,
        e.landingFront + e.treadDepth * (i + .5), white);
    }
    // A solid wedge has exact top endpoints, unlike a rotated cuboid.
    const x0 = e.rampX - e.rampWidth / 2, x1 = e.rampX + e.rampWidth / 2;
    const z0 = e.landingFront, z1 = e.rampEnd;
    const wedge = new THREE.BufferGeometry();
    wedge.setAttribute('position', new THREE.Float32BufferAttribute([
      x0,.06,z0, x1,.06,z0, x1,.06,z1, x0,.06,z1,
      x0,e.landingTop,z0, x1,e.landingTop,z0, x1,e.groundTop,z1, x0,e.groundTop,z1,
    ], 3));
    wedge.setIndex([4,7,6,4,6,5, 0,1,2,0,2,3, 0,4,5,0,5,1, 3,2,6,3,6,7, 0,3,7,0,7,4, 1,5,6,1,6,2]);
    wedge.computeVertexNormals(); this.mesh(wedge, stone);
    for (const x of [x0, x1]) {
      this.rail([[x,e.landingTop+.76,z0],[x,e.groundTop+.76,z1]], .035, metal);
      for (let i = 0; i < 4; i++) {
        const z = z0 + (z1 - z0) * i / 3, y = rampHeightAt(z);
        this.rail([[x,y,z],[x,y+.76,z]], .027, metal);
      }
    }
    // Parking bay and approach.
    this.box(2.8,.035,4.7,-7.2,.08,3, this.material(0xd1ddd6));
    for (const x of [-8.6,-5.8]) this.box(.05,.02,4.7,x,.11,3,white);
    for (const z of [.65,5.35]) this.box(2.8,.02,.05,-7.2,.11,z,white);
    // Vector parking symbol: crisp at every rendering density.
    this.ring(.48, -7.2, .135, 3.2, 0xffffff, 1);
    this.rail([[-7.35,.15,2.45],[-7.35,.15,3.05],[-6.92,.15,3.05],[-6.65,.15,3.55]], .045, white);
    this.cylinder(.1,.02,-7.35,.15,2.2,white);
    this.rail([[-8.7,.15,.4],[-8.7,2,.4]], .045,metal);
    this.box(.55,.5,.045,-8.7,1.9,.45,green);
    this.box(1.15,.06,6.5,-5.75,.12,3.6,white);
    this.box(6,.06,1.05,-3.6,.12,7.2,white);
    // Interior: circulation and stairs.
    this.box(3.5,.025,6.9,-1.4,.58,0,this.material(0xe1e9e2));
    for (let i=0;i<9;i++) this.box(1.65,(i+1)*.2,.32,-3.5,.58+(i+1)*.1,-.8-i*.32,white);
    for (const x of [-4.27,-2.73]) {
      this.rail([[x,1.5,-.6],[x,3.05,-3.45]],.035,metal);
      for(let i=0;i<4;i++) this.rail([[x,.78+i*.5,-.8-i*.8],[x,1.55+i*.5,-.8-i*.8]],.026,metal);
    }
    // Lift with readable doors and call button.
    this.box(2,3,.18,-.6,2.05,-3.65,stone);
    this.box(1.5,2.6,.08,-.6,1.9,-3.52,glass);
    this.box(.04,2.6,.04,-.6,1.9,-3.46,metal);
    this.rail([[-.78,3.23,-3.48],[-.6,3.41,-3.48],[-.42,3.23,-3.48]],.025,metal);
    this.box(.14,.3,.1,.48,1.7,-3.5,green);
    // Toilet room: low cutaway partitions preserve the sightline.
    this.box(.15,1.4,4.5,1.45,1.26,-1.6,white);
    this.box(1,1.4,.15,2,1.26,.65,white);
    this.box(.6,1.4,.15,4.7,1.26,.65,white);
    this.box(3.35,.03,4.15,3.2,.59,-1.65,this.material(0xe1e6e1));
    for (let x=1.8;x<5;x+=.65) this.box(.012,.012,4.1,x,.612,-1.65,white);
    for (let z=-3.6;z<.5;z+=.65) this.box(3.3,.012,.012,3.2,.612,z,white);
    this.ring(.82,2.85,.63,-.8,0x719781,.6);
    this.cylinder(.24,.4,3.65,.82,-2.9,white);
    const bowl=this.mesh(new THREE.SphereGeometry(.38,24,12),white); bowl.scale.set(1,.36,1.25);bowl.position.set(3.65,1.05,-2.84);
    const seat=this.mesh(new THREE.TorusGeometry(.27,.065,10,32),white);seat.rotation.x=-Math.PI/2;seat.scale.y=1.3;seat.position.set(3.65,1.17,-2.8);
    this.box(.65,.7,.28,3.65,1.2,-3.4,white,this.root,true);
    this.box(.12,.035,.08,3.65,1.57,-3.4,metal);
    this.rail([[3.04,.65,-3.35],[3.04,1.48,-3.35],[3.04,1.48,-2.32]],.045,metal);
    this.rail([[4.25,1.5,-3.65],[4.25,1.5,-2.1]],.045,metal);
    this.box(.8,.14,.65,2.05,1.4,-2.9,white,this.root,true);
    this.cylinder(.18,.04,2.05,1.49,-2.9,stone);
    this.rail([[2.05,1.48,-3.12],[2.05,1.74,-3.12],[2.05,1.74,-2.96]],.025,metal);
    this.box(.22,.3,.04,4.45,1.6,-3.86,green);
    this.box(.1,.1,.035,4.45,1.61,-3.82,this.material(0xad4b41),this.root,true);
    // A few landscape elements, kept clear of the inspection route.
    this.tree(-7.7,-4.7,1.1);this.tree(7.3,-4.1,1.3);this.tree(7.8,4.8,.9);this.tree(-8.2,-1.7,.8);
    this.box(2,.14,.55,6.9,.6,2.2,this.material(0xa7b2a3),this.root,true);
    this.box(.14,.55,.5,6.2,.3,2.2,stone);this.box(.14,.55,.5,7.6,.3,2.2,stone);
    const patchData=[[3.25,5.1,-7.2,.13,3],[3.5,2.2,-1.9,entrance.landingTop+.008,4.7],[3.4,6,-1.4,.62,-.3],[3.3,4.1,3.2,.64,-1.65]];
    patchData.forEach(([w,d,x,y,z])=>{
      const m = new THREE.MeshBasicMaterial({color:0x3d8a66,transparent:true,opacity:0,depthWrite:false});
      const patch=this.mesh(new THREE.PlaneGeometry(w,d),m);patch.rotation.x=-Math.PI/2;patch.position.set(x,y,z);patch.castShadow=false;this.patches.push(patch);
    });
    routes.forEach((points, zone) => this.route(points, zone));
    // Stable shader/depth settings: animation changes opacity only, never material modes.
    for (const group of [this.facade, this.roof]) group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = false;
      object.renderOrder = object.userData.shellLayer ?? (group === this.roof ? 20 : object.material === shellGlass ? 11 : 10);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        material.transparent = true; material.depthWrite = false;
        if (!this.facadeMaterials.includes(material)) this.facadeMaterials.push(material);
      });
    });
    this.setAppearance(0);
  }
  private setAppearance(cutaway:number) {
    this.cutaway=cutaway;
    // The exterior dissolves in place, with no moving windows or floating roof.
    this.facadeMaterials.forEach(material => { material.opacity = 1 - cutaway; });
    this.patches.forEach((mesh, i) => { (mesh.material as THREE.MeshBasicMaterial).opacity = this.weights[i] * .14; });
    this.routeMeshes.forEach((mesh, i) => { (mesh.material as THREE.MeshBasicMaterial).opacity = this.weights[i]; });
  }

  select(index:ZoneIndex) {
    this.selected=index;
    this.transition={started:performance.now(),position:this.camera.position.clone(),target:this.currentTarget.clone(),span:this.span,cutaway:this.cutaway,weights:[...this.weights]};
    this.request();
  }
  private resize() {
    this.width=this.container.clientWidth;this.height=this.container.clientHeight;
    if (!this.width || !this.height) return;
    const ratio = Math.min(devicePixelRatio, 3, Math.sqrt(3_000_000 / (this.width * this.height)));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width,this.height,false);this.request();
  }
  private request() { if(!this.frame&&!this.disposed&&this.initialized&&!document.hidden) this.frame=requestAnimationFrame(this.render); }
  private render = (now:number) => {
    this.frame=0;if(this.disposed)return;
    const pose=poses[this.selected];
    if(this.transition){
      const t=this.reduce.matches?1:Math.min(1,(now-this.transition.started)/1500);
      const e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
      this.camera.position.lerpVectors(this.transition.position,pose.position,e);
      this.currentTarget.lerpVectors(this.transition.target,pose.target,e);
      this.span=THREE.MathUtils.lerp(this.transition.span,pose.span,e);
      this.weights = this.transition.weights.map((weight, i) => THREE.MathUtils.lerp(weight, i === this.selected ? 1 : 0, e));
      this.setAppearance(THREE.MathUtils.lerp(this.transition.cutaway,this.selected>=2?1:0,e));
      if(t>=1){this.transition=null;this.onSettled?.();}
    }
    const aspect=this.width/this.height;
    // A minimum horizontal span keeps the entire model inside a portrait viewport.
    const span=this.span*Math.max(1,.93/aspect);
    this.camera.left=-span*aspect/2;this.camera.right=span*aspect/2;
    this.camera.top=span/2;this.camera.bottom=-span/2;this.camera.near=.1;this.camera.far=100;
    this.camera.lookAt(this.currentTarget);this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene,this.camera);
    this.onProject?.(this.markers.map((p,i)=>{const v=p.clone().project(this.camera);return{x:(v.x*.5+.5)*this.width,y:(-.5*v.y+.5)*this.height,opacity:this.weights[i],visible:i===this.selected&&this.weights[i]>.01&&Math.abs(v.x)<.82&&Math.abs(v.y)<.85};}));
    if(this.transition)this.request();
  };
  private visibility=()=>{if(document.hidden){cancelAnimationFrame(this.frame);this.frame=0;}else this.request();};
  private motion=()=>this.request();
  private contextLost=(event:Event)=>{event.preventDefault();this.container.dispatchEvent(new CustomEvent('scene-unavailable'));};
  dispose(){
    this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange',this.visibility);this.reduce.removeEventListener('change',this.motion);
    this.renderer.domElement.removeEventListener('webglcontextlost',this.contextLost);
    this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());
    this.renderer.dispose();this.renderer.domElement.remove();
  }
}
