import type { OfficeScene, OfficeMember, StatusLabel } from '../../types.ts';
import { createActivityEffects } from '../activity-effects.ts';
import { createTeamActivities } from './activities.ts';
import { createOfficeProps } from './props.ts';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeTeamOffice } from './model.ts';
import { layoutNameplates } from './nameplates.ts';
import { assignTeamSeats, STATIONS } from './layout.ts';
import { createTeamMotion, updateTeamMotion, poseTeamCharacter, statusMotion } from './motion.ts';
import { createFollowCamera } from './follow-camera.ts';

export async function createTeamOfficeScene(element: HTMLElement, onSelect: (id: string) => void, onError: (error: Error) => void): Promise<OfficeScene> {
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-16, 16, 12, -12, .1, 150);
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), point = new THREE.Vector3();
  let renderer: THREE.WebGLRenderer, model: ReturnType<typeof makeTeamOffice>, controls: OrbitControls, observer: ResizeObserver, activities: ReturnType<typeof createTeamActivities>, effects: ReturnType<typeof createActivityEffects>, props: ReturnType<typeof createOfficeProps>, stageGeo: THREE.PlaneGeometry, stageMat: THREE.ShadowMaterial, frame = 0, last = 0, active = false, destroyed = false;
  let members: OfficeMember[] = [], seats = new Map<string, number>(), labelFor: StatusLabel = value => value, selected: string | null = null;
  const motions = STATIONS.map((_, i) => createTeamMotion(i));
  let following: string | null = null, follow: ReturnType<typeof createFollowCamera>;
  const plates = new Map<string, HTMLButtonElement>(), stems = new Map<string, SVGLineElement>();
  const labelMetrics = document.createElement('canvas').getContext('2d');
  if (labelMetrics) labelMetrics.font = '600 10px system-ui';
  const svgNS = 'http://www.w3.org/2000/svg';
  const leaders = document.createElementNS(svgNS, 'svg'); leaders.classList.add('office-nameplate-lines'); leaders.setAttribute('aria-hidden', 'true');
  let pointerStart: [number, number] | undefined;
  function hit(event: PointerEvent): number | null {
    const r = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX-r.left)/r.width*2-1, -(event.clientY-r.top)/r.height*2+1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(model.characters.filter(rig => rig.avatar.visible).map(rig => rig.avatar), true);
    if (!hits.length) return null;
    let object: THREE.Object3D | null = hits[0].object; while (object && object.userData.seat === undefined) object = object.parent;
    return object?.userData.seat ?? null;
  }
  const down = (event: PointerEvent) => { pointerStart = [event.clientX,event.clientY]; };
  const move = (event: PointerEvent) => { renderer.domElement.style.cursor = hit(event) === null ? 'grab' : 'pointer'; };
  const up = (event: PointerEvent) => {
    if (!pointerStart || Math.hypot(event.clientX-pointerStart[0],event.clientY-pointerStart[1]) > 5) return;
    const index = hit(event); if (index === null) return;
    const member = members.find(item => seats.get(item.id) === index); if (member) onSelect(member.id);
  };
  const key = (event: KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ')) {
      const member = members.find(item => item.id === selected) ?? members[0];
      if (member) { event.preventDefault(); onSelect(member.id); }
    }
  };
  const lost = (event: Event) => { if (!destroyed) { event.preventDefault(); setActive(false); onError(new Error('WebGL context lost')); } };
  const detachEvents: (() => void)[] = [];
  function listen<K extends keyof HTMLElementEventMap>(canvas: HTMLCanvasElement, name: K, listener: (event: HTMLElementEventMap[K]) => void) {
    canvas.addEventListener(name, listener);
    detachEvents.push(() => canvas.removeEventListener(name, listener));
  }
  function draw(now: number) {
    if (destroyed || !active) return;
    frame = requestAnimationFrame(draw);
    if (last && now-last < 1000/30) return;
    const dt = last ? Math.min((now-last)/1000,.05) : 0; last=now;
    activities?.tick(dt);
    const bySeat = new Map(members.map(member => [seats.get(member.id),member]));
    model.characters.forEach((rig,index) => {
      const member = bySeat.get(index); rig.avatar.visible = !!member;
      if (!member) { rig.ring.visible = false; return; }
      const mode = activities?.owns(member.id) ? 'activity' : statusMotion(member.status);
      updateTeamMotion(motions[index], mode, dt); poseTeamCharacter(rig,motions[index]);
    });
    if (following !== null) {
      const index = seats.get(following);
      if (index !== undefined) follow.update(model.characters[index].avatar.position);
    }
    controls.update(); renderer.render(scene,camera); effects?.draw(dt);
    const projected = [];
    for (const [id, plate] of plates) {
      const rig = model.characters[seats.get(id)!];
      point.copy(rig.avatar.position); point.y += 1.60; point.project(camera);
      plate.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      stems.get(id)!.style.display = plate.hidden ? 'none' : '';
      if (!plate.hidden) projected.push({ id, width: Number(plate.dataset.width), x: (point.x * .5 + .5) * element.clientWidth, y: (-point.y * .5 + .5) * element.clientHeight });
    }
    const anchors = new Map(projected.map(item => [item.id, item]));
    for (const position of layoutNameplates(projected, element.clientWidth, element.clientHeight)) {
      const plate = plates.get(position.id)!; plate.style.left = `${position.x}px`; plate.style.top = `${position.y}px`; plate.style.width = `${position.width}px`;
      const line = stems.get(position.id)!, anchor = anchors.get(position.id)!;
      for (const [key, value] of Object.entries({ x1: position.x, y1: position.y, x2: anchor.x, y2: anchor.y + 4 })) line.setAttribute(key, String(value));
    }
  }
  function setActive(value: boolean) {
    if (destroyed || active === value) return;
    active = value;
    last = 0;
    cancelAnimationFrame(frame);
    if (active) frame = requestAnimationFrame(draw);
  }
  function fit() {
    following = null;
    follow.stop();
    camera.position.set(19, 23, 28);
    controls.target.set(0, .45, 0);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    active = false;

    // Stop callbacks before releasing the resources they use.
    cancelAnimationFrame(frame);
    observer?.disconnect();
    controls?.dispose();
    for (const detach of detachEvents) detach();
    detachEvents.length = 0;

    activities?.dispose();
    effects?.destroy();
    props?.destroy();
    model?.dispose();
    stageGeo?.dispose();
    stageMat?.dispose();
    scene.traverse(item => {
      if (item instanceof THREE.DirectionalLight || item instanceof THREE.SpotLight) item.shadow.dispose();
    });

    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
    for (const plate of plates.values()) plate.remove();
    plates.clear();
    stems.clear();
    leaders.remove();
  }
  try {
    renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setClearColor('#e9e5dc'); renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.1;
    renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.VSMShadowMap;
    const canvas=renderer.domElement; canvas.className='office-3d-canvas'; canvas.tabIndex=0; canvas.setAttribute('aria-label','DSH team office · 16 teammates + Lead');
    listen(canvas, 'pointerdown', down); listen(canvas, 'pointerup', up); listen(canvas, 'pointermove', move);
    listen(canvas, 'keydown', key);
    canvas.addEventListener('webglcontextlost', lost);
    detachEvents.push(() => canvas.removeEventListener('webglcontextlost', lost));
    element.append(canvas, leaders);
    model=makeTeamOffice(); scene.add(model.root); model.characters.forEach((rig,i)=>{rig.avatar.userData.seat=i;});
    effects = createActivityEffects(element, id => {
      const rig = model.characters[seats.get(id)!]; if (!rig?.avatar.visible) return null;
      const p = rig.avatar.position.clone(); p.y += 1.45; p.project(camera);
      if (Math.abs(p.x)>1 || Math.abs(p.y)>1) return null;
      return {x:(p.x*.5+.5)*element.clientWidth,y:(-p.y*.5+.5)*element.clientHeight};
    });
    props = createOfficeProps(model.root, model.characters);
    activities = createTeamActivities({ motions, seats:()=>seats, members:()=>members.filter(m=>seats.has(m.id)), effects, props });
    scene.add(new THREE.HemisphereLight('#edf6ff','#ad987d',1.85));
    const sun=new THREE.DirectionalLight('#fff0d6',2.2); sun.position.set(-8,20,12); sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048); sun.shadow.radius=3; sun.shadow.blurSamples=6; sun.shadow.bias=-.0002; sun.shadow.normalBias=.025;
    Object.assign(sun.shadow.camera,{left:-18,right:18,top:16,bottom:-16,near:.5,far:60}); scene.add(sun);
    const fill=new THREE.DirectionalLight('#dae9ff',.65); fill.position.set(12,8,-5); scene.add(fill);
    stageGeo=new THREE.PlaneGeometry(160,160); stageMat=new THREE.ShadowMaterial({opacity:.045});
    const stage=new THREE.Mesh(stageGeo,stageMat); stage.rotation.x=-Math.PI/2; stage.position.y=-.31; stage.receiveShadow=true; scene.add(stage);
    controls=new OrbitControls(camera,canvas); controls.enableDamping=true; controls.enablePan=true;
    controls.minPolarAngle=.38; controls.maxPolarAngle=1.16; controls.minAzimuthAngle=-.18; controls.maxAzimuthAngle=1.40;
    controls.minZoom=.75; controls.maxZoom=6; follow=createFollowCamera(camera,controls); fit();
    const resize = () => {
      if (destroyed) return;
      const w = Math.max(100, element.clientWidth), h = Math.max(100, element.clientHeight), a = w / h;
      renderer.setSize(w, h);
      const extent = Math.max(10.4, 14.8 / a);
      camera.left = -extent * a;
      camera.right = extent * a;
      camera.top = extent;
      camera.bottom = -extent;
      camera.updateProjectionMatrix();
    };
    observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    setActive(true);
    return { destroy,setActive,fit,
      activities(events, options) { props.tasks(options.tasks ?? []); effects.label(options.label); effects.tools(Object.fromEntries(Object.entries(options.tools ?? {}).filter(([id])=>members.some(m=>m.id===id&&m.status==='running')))); if(options.reset)activities.reset(); activities.enqueue(events); },
      focus(id) {
        if (id === null) { following=null; follow.stop(); return true; }
        const index=seats.get(id); if(index===undefined) return false;
        following=id; follow.start(model.characters[index].avatar.position); return true;
      },
      update(values,statusLabel,id) {
        const next=assignTeamSeats(seats,values);
        // Reset only newly occupied seats; polling/reordering retains motion and identity.
        for(const [memberId,index] of next) if(seats.get(memberId)!==index) motions[index]=createTeamMotion(index);
        seats=next; members=values; labelFor=statusLabel; selected=id; activities.update();
        if (following !== null && !seats.has(following)) { following=null; follow.stop(); }
        for (const [memberId, plate] of plates) if (!seats.has(memberId)) { plate.remove(); plates.delete(memberId); stems.get(memberId)!.remove(); stems.delete(memberId); }
        for (const member of members) {
          if (!seats.has(member.id)) continue;
          let plate = plates.get(member.id);
          if (!plate) { plate = document.createElement('button'); plate.type = 'button'; plate.className = 'office-nameplate'; plate.onclick = () => onSelect(member.id); plates.set(member.id, plate); element.append(plate); const stem = document.createElementNS(svgNS, 'line'); stems.set(member.id, stem); leaders.append(stem); }
          plate.dataset.width = String(Math.min(160, Math.max(42, Math.ceil(labelMetrics?.measureText(member.name).width ?? member.name.length * 10) + 16)));
          plate.textContent = member.name; plate.title = `${member.name} · ${labelFor(member.status)}`;
          plate.setAttribute('aria-label', plate.title); plate.setAttribute('aria-pressed', String(member.id === selected));
        }
      },
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
