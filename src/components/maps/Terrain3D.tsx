import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { HMAX, cellColor, colorJitter, objDef, renderTopDown, slopeAt, smoothLine, strokePts, strokeWidth, worldSize, type MapObject, type Pin, type Tool } from '../../mapdata';

/** the land is cut into tiles of this many cells, so painting only rebuilds the tiles under the brush */
const TILE = 64;
/** maps bigger than a small one can't be seen all at once: you travel across them */
const SMALL = worldSize(160);
const isBig = (N: number) => N > 160;
/** the sky: deep blue overhead fading to a pale haze at the horizon (far-off land fades into the haze) */
const SKY_TOP = '#6f9bc8', HORIZON = '#d5e1ea';
/** where the sunlight comes from (from the left, a little toward you): gives hills light and shadow sides like the 2D view */
const SUN_DIR = new THREE.Vector3(-1, 0.85, 0.5).normalize();

/** a journey as drawn: the stops reached so far */
export interface JourneyDraw { id: string; name: string; color: string; stops: { u: number; v: number }[]; selected: boolean }

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface TerrainProps {
  N: number; heights: Float32Array; paint: Uint8Array; sea: number; heightScale: number; aspect: number;
  image?: string; useImage: boolean; lowPoly: boolean; version: number; tool: Tool; brush: number;
  pins: Pin[]; selectedPin: string | null;
  objects: MapObject[]; selectedObject: string | null; pendingLine: { u: number; v: number } | null;
  /** the tool draws a line by dragging (paths, roads, rivers) */
  drawLine: boolean;
  journeys: JourneyDraw[];
  /** the part of the grid that changed since the last draw (null = everything) */
  dirtyRef: React.MutableRefObject<Rect | null>;
  onStroke: (cx: number, cy: number, first: boolean) => void; onStrokeEnd: () => void;
  onPlacePin: (u: number, v: number) => void; onSelectPin: (id: string) => void;
  onPlaceObject: (u: number, v: number) => void; onSelectObject: (id: string | null) => void; onMoveObject: (id: string, du: number, dv: number) => void;
  snapshotRef?: React.MutableRefObject<(() => string) | null>;
}

interface Chunk { mesh: THREE.Mesh; x0: number; y0: number; x1: number; y1: number }
interface State {
  renderer: THREE.WebGLRenderer; labels: CSS2DRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  land: THREE.Group; chunks: Chunk[]; material: THREE.MeshStandardMaterial; water: THREE.Mesh; skirt: THREE.Mesh; ring: THREE.Mesh; pins: THREE.Group;
  strokes: THREE.Group; journeys: THREE.Group; sun: THREE.DirectionalLight; follow: () => void; ripples: THREE.Texture;
  objects: THREE.Group; owners: Map<THREE.InstancedMesh, string[]>; marker: THREE.Mesh; render: () => void; tex?: THREE.Texture; key: string;
  mini: HTMLDivElement; drawMiniBase: () => void; drawMiniMark: () => void; miniT: number;
}

/** Sculptable 3D terrain (three.js). Same data as the 2D view. */
export function Terrain3D(p: TerrainProps) {
  const host = useRef<HTMLDivElement>(null);
  const S = useRef<State | null>(null);
  const props = useRef(p); props.current = p;
  const lastLook = useRef<{ sea: number; hs: number; lowPoly: boolean }>({ sea: NaN, hs: NaN, lowPoly: false });
  const dims = () => { const W0 = worldSize(props.current.N); return { W: W0 * props.current.aspect, D: W0, S0: W0 }; };
  const surfaceRef = useRef<(u: number, v: number) => number>(() => 0);

  // ---- set up the scene once
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'map-labels';
    el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = skyTexture();
    scene.fog = new THREE.Fog(new THREE.Color(HORIZON), 220, 420);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 4000);
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a3f33, 0.6));
    // the sun follows where you're looking, so its shadows stay sharp near you on any size of map
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.7); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
    scene.add(sun, sun.target);

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    // fine grain on the ground that shows up close (patches of grass, dirt and stones), and fades out with distance
    material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGrainPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vGrainPos;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y); }
float grain(vec2 p, float k) { float fade = clamp(1.0 - fwidth(p.x * k) * 1.5, 0.0, 1.0); return (gNoise(p * k) - 0.5) * fade; }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= 1.0 + grain(vGrainPos.xz, 0.35) * 0.22 + grain(vGrainPos.xz, 2.2) * 0.16 + grain(vGrainPos.xz, 11.0) * 0.1;`);
    };
    const land = new THREE.Group(); scene.add(land);
    // the map is a block of land, like a diorama: earth walls around the sides and underneath,
    // and the sea is a see-through block of water that fills it up to sea level
    const skirt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
    scene.add(skirt);
    const ripples = rippleTexture();
    const water = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x2c6d99, transparent: true, opacity: 0.62, roughness: 0.1, metalness: 0.05, normalMap: ripples, normalScale: new THREE.Vector2(0.35, 0.35), depthWrite: false }));
    water.receiveShadow = true;
    water.renderOrder = 2; scene.add(water);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.renderOrder = 10; ring.visible = false; scene.add(ring);
    // marks the selected thing / the start of a wall
    const marker = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.85, 40), new THREE.MeshBasicMaterial({ color: 0x8b7cf6, transparent: true, opacity: 0.95, depthTest: false }));
    marker.rotation.x = -Math.PI / 2; marker.renderOrder = 11; marker.visible = false; scene.add(marker);
    const pins = new THREE.Group(); scene.add(pins);
    const objects = new THREE.Group(); scene.add(objects);
    const strokes = new THREE.Group(); scene.add(strokes);
    const journeys = new THREE.Group(); scene.add(journeys);

    const controls = new OrbitControls(camera, renderer.domElement);
    // close enough to stand next to a house, far enough to see a lot of the world
    controls.maxPolarAngle = Math.PI * 0.48; controls.minDistance = 0.25;
    controls.zoomToCursor = true; // scroll toward what you point at (zoom straight into a village)
    // draw at most once per frame, however many things ask for it
    const renderNow = () => { cancelAnimationFrame(rq); rq = 0; renderer.render(scene, camera); labels.render(scene, camera); };
    let rq = 0;
    const render = () => { if (!rq) rq = requestAnimationFrame(renderNow); };
    controls.screenSpacePanning = false; // right-drag slides along the ground, so you can travel across big worlds

    const groundAt = (u: number, v: number) => surfaceRef.current(Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));

    // ---- overview map in the corner (big maps): where you are, click or drag to go somewhere
    const mini = document.createElement('div'); mini.className = 'map-mini'; mini.hidden = true;
    mini.title = 'Where you are. Click or drag to go somewhere.';
    const miniBase = document.createElement('canvas'), miniMark = document.createElement('canvas');
    mini.append(miniBase, miniMark); el.appendChild(mini);
    const drawMiniBase = () => {
      if (mini.hidden) return;
      const { N, heights, paint, sea } = props.current;
      const t = document.createElement('canvas'); t.width = N; t.height = N;
      renderTopDown(t.getContext('2d')!, heights, paint, N, sea, true, props.current.heightScale);
      const c = miniBase.getContext('2d')!; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.drawImage(t, 0, 0, miniBase.width, miniBase.height);
    };
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), mray = new THREE.Raycaster(), corner = new THREE.Vector2(), hitPt = new THREE.Vector3();
    const drawMiniMark = () => {
      if (mini.hidden) return;
      const { W, D } = dims(); const w = miniMark.width, h = miniMark.height; const c = miniMark.getContext('2d')!;
      c.clearRect(0, 0, w, h);
      const far = (scene.fog as THREE.Fog).far;
      // the patch of ground you can see: where the corners of the screen meet the land (up to the haze)
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
        mray.setFromCamera(corner.set(x, y), camera);
        const hit = mray.ray.intersectPlane(ground, hitPt);
        const t = Math.min(hit ? mray.ray.origin.distanceTo(hitPt) : Infinity, far);
        const q = mray.ray.at(t, new THREE.Vector3());
        return [(q.x / W + 0.5) * w, (q.z / D + 0.5) * h];
      });
      c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
      c.fillStyle = 'rgba(255,255,255,.16)'; c.fill();
      c.lineWidth = 1.5 * (w / miniMark.clientWidth || 1); c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke();
      const tx = (controls.target.x / W + 0.5) * w, tz = (controls.target.z / D + 0.5) * h;
      c.beginPath(); c.arc(tx, tz, 3.5 * (w / miniMark.clientWidth || 1), 0, Math.PI * 2); c.fillStyle = '#8b7cf6'; c.fill();
    };
    const moveBy = (dx: number, dz: number) => {
      controls.target.x += dx; controls.target.z += dz; camera.position.x += dx; camera.position.z += dz; controls.update();
    };
    const goTo = (e: PointerEvent) => {
      const r = mini.getBoundingClientRect(); const { W, D } = dims();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      moveBy((u - 0.5) * W - controls.target.x, (v - 0.5) * D - controls.target.z);
    };
    mini.addEventListener('pointerdown', (e) => { e.preventDefault(); mini.setPointerCapture(e.pointerId); goTo(e); });
    mini.addEventListener('pointermove', (e) => { if (e.buttons & 1) goTo(e); });

    controls.addEventListener('change', () => {
      // stay over the map, and let the haze follow how far out you are
      const { W, D } = dims(); const t = controls.target;
      const cx = Math.max(-W / 2, Math.min(W / 2, t.x)), cz = Math.max(-D / 2, Math.min(D / 2, t.z));
      if (cx !== t.x || cz !== t.z) { camera.position.x += cx - t.x; camera.position.z += cz - t.z; t.x = cx; t.z = cz; }
      // the point you orbit around sits on the ground (or the water), so zooming in lands next to things, not inside a hill
      const { sea, heightScale } = props.current;
      const gy = Math.max(groundAt(t.x / W + 0.5, t.z / D + 0.5), sea * heightScale);
      if (Math.abs(gy - t.y) > 1e-4) { camera.position.y += gy - t.y; t.y = gy; }
      // and the camera never goes below the land
      const under = Math.max(groundAt(camera.position.x / W + 0.5, camera.position.z / D + 0.5), sea * heightScale) + 0.08;
      if (camera.position.y < under) camera.position.y = under;
      follow();
      drawMiniMark();
      render();
    });
    // things that depend on how far out you are: the haze, the sun's shadow area, the camera's depth range, pin size
    const follow = () => {
      const t = controls.target, dist = camera.position.distanceTo(t), fog = scene.fog as THREE.Fog, big = isBig(props.current.N);
      // on big maps the far-off land fades away, so there is always more out there
      fog.near = dist * (big ? 1.1 : 1.6); fog.far = dist * (big ? 2.8 : 3.4);
      camera.near = Math.max(0.01, Math.min(5, dist * 0.01)); camera.far = Math.max(dims().S0 * 6, dist * 10); camera.updateProjectionMatrix();
      const half = Math.max(1.5, Math.min(dims().S0 * 0.75, dist * 1.25)), top = props.current.heightScale * HMAX;
      const R = half * 2 + top;
      sun.target.position.copy(t); sun.position.copy(t).addScaledVector(SUN_DIR, R);
      const sc = sun.shadow.camera;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 0.1; sc.far = R * 2 + top; sc.updateProjectionMatrix();
      sun.shadow.normalBias = (2 * half / 2048) * 1.5;
      const k = Math.max(0.03, Math.min(Math.max(1, dims().S0 / 100), dist / 90));
      for (const g of pins.children) g.scale.setScalar(k);
    };

    // ---- arrow keys travel across the land (Shift = faster)
    const held = new Set<string>(); let walkRaf = 0, last = 0, fast = false;
    const fwd = new THREE.Vector3();
    const walk = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!held.size || !el.isConnected) { walkRaf = 0; return; }
      fwd.subVectors(controls.target, camera.position); fwd.y = 0; fwd.normalize();
      let f = 0, r = 0;
      if (held.has('ArrowUp')) f++; if (held.has('ArrowDown')) f--; if (held.has('ArrowRight')) r++; if (held.has('ArrowLeft')) r--;
      const sp = camera.position.distanceTo(controls.target) * 0.8 * dt * (fast ? 3 : 1);
      moveBy((fwd.x * f - fwd.z * r) * sp, (fwd.z * f + fwd.x * r) * sp);
      walkRaf = requestAnimationFrame(walk);
    };
    const keyDown = (e: KeyboardEvent) => {
      if (!e.key.startsWith('Arrow') || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], [role="slider"]')) return;
      e.preventDefault(); held.add(e.key); fast = e.shiftKey;
      if (!walkRaf) { last = performance.now(); walkRaf = requestAnimationFrame(walk); }
    };
    const keyUp = (e: KeyboardEvent) => { held.delete(e.key); fast = e.shiftKey; };
    const blur = () => held.clear();
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', blur);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); labels.setSize(w, h);
      for (const l of journeys.children) if (l instanceof Line2) (l.material as LineMaterial).resolution.set(w, h);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); renderNow();
    };
    const ro = new ResizeObserver(resize); ro.observe(el);
    S.current = { renderer, labels, scene, camera, controls, land, chunks: [], material, water, skirt, ring, pins, objects, owners: new Map(), marker, render, key: '', mini, drawMiniBase, drawMiniMark, miniT: 0, strokes, journeys, sun, follow, ripples };
    if (p.snapshotRef) p.snapshotRef.current = () => { renderNow(); return renderer.domElement.toDataURL('image/png'); };

    // ---- pointer: sculpt / paint / place pins and things / pick and move things
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    let drawing = false, pending: { x: number; y: number } | null = null, raf = 0;
    let moving: { id: string; u0: number; v0: number; moved: boolean } | null = null;
    const aim = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    const hitLand = (e: PointerEvent) => { aim(e); return ray.intersectObjects(S.current!.chunks.map((c) => c.mesh), false)[0]; };
    const hitThing = (e: PointerEvent) => {
      aim(e);
      const h = ray.intersectObjects(objects.children, false)[0] as (THREE.Intersection & { instanceId?: number }) | undefined;
      if (!h || h.instanceId === undefined) return null;
      return S.current!.owners.get(h.object as THREE.InstancedMesh)?.[h.instanceId] ?? null;
    };
    /** the drawn line (path, road, river) nearest a point on the land, if it's close */
    const nearStroke = (pt: THREE.Vector3) => {
      const { W, D } = dims(); const dist = camera.position.distanceTo(controls.target);
      let best: string | null = null, bd = Infinity;
      for (const o of props.current.objects) {
        if (!o.pts) continue;
        const ps = strokePts(o).map(([u, v]) => [(u - 0.5) * W, (v - 0.5) * D]);
        const lim = Math.max(strokeWidth(o) * 0.75, dist * 0.02);
        for (let i = 0; i + 1 < ps.length; i++) {
          const [ax, az] = ps[i], [bx, bz] = ps[i + 1], dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
          const t = L ? Math.max(0, Math.min(1, ((pt.x - ax) * dx + (pt.z - az) * dz) / L)) : 0;
          const d = Math.hypot(ax + t * dx - pt.x, az + t * dz - pt.z);
          if (d < lim && d < bd) { bd = d; best = o.id; }
        }
      }
      return best;
    };
    /** at real size things can be a few pixels big: pick the one nearest the click on screen (within ~14 px) */
    const nearOnScreen = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect(); const { W, D } = dims(); const v = new THREE.Vector3();
      const z = r.width / Math.max(1, renderer.domElement.clientWidth) || 1;
      let best: string | null = null, bd = 14 * z;
      for (const o of props.current.objects) {
        if (o.pts) continue;
        const u = o.u2 !== undefined ? (o.u + o.u2) / 2 : o.u, w = o.v2 !== undefined ? (o.v + (o.v2 ?? o.v)) / 2 : o.v;
        v.set((u - 0.5) * W, surfaceRef.current(u, w), (w - 0.5) * D).project(camera);
        if (v.z > 1) continue;
        const d = Math.hypot((v.x * 0.5 + 0.5) * r.width + r.left - e.clientX, (-v.y * 0.5 + 0.5) * r.height + r.top - e.clientY);
        if (d < bd) { bd = d; best = o.id; }
      }
      return best;
    };
    const toGrid = (pt: THREE.Vector3) => {
      const { N } = props.current; const { W, D } = dims();
      const u = pt.x / W + 0.5, v = pt.z / D + 0.5;
      return { u, v, x: u * (N - 1), y: v * (N - 1) };
    };
    const down = (e: PointerEvent) => {
      const tool = props.current.tool;
      if (e.button !== 0 || tool === 'view') return;
      if (tool === 'select') {
        let id = hitThing(e) ?? nearOnScreen(e);
        if (!id) { const l = hitLand(e); if (l) id = nearStroke(l.point); }
        props.current.onSelectObject(id);
        const h = id ? hitLand(e) : undefined;
        if (id && h) { const g = toGrid(h.point); moving = { id, u0: g.u, v0: g.v, moved: false }; renderer.domElement.setPointerCapture(e.pointerId); controls.enabled = false; }
        return;
      }
      const h = hitLand(e); if (!h) return;
      const g = toGrid(h.point);
      if (tool === 'pin') { props.current.onPlacePin(g.u, g.v); return; }
      if ((tool === 'object' && !props.current.drawLine) || tool === 'journey') { props.current.onPlaceObject(g.u, g.v); return; }
      drawing = true; renderer.domElement.setPointerCapture(e.pointerId);
      props.current.onStroke(g.x, g.y, true);
    };
    const move = (e: PointerEvent) => {
      const tool = props.current.tool;
      if (moving) {
        const h = hitLand(e);
        if (h) {
          const g = toGrid(h.point);
          const du = g.u - moving.u0, dv = g.v - moving.v0;
          if (Math.abs(du) + Math.abs(dv) > 0.0005) { moving.moved = true; props.current.onMoveObject(moving.id, du, dv); moving.u0 = g.u; moving.v0 = g.v; }
        }
        return;
      }
      const brushTool = tool !== 'view' && tool !== 'pin' && tool !== 'object' && tool !== 'select' && tool !== 'journey';
      const h = brushTool ? hitLand(e) : undefined;
      if (h) {
        const { N, aspect, brush } = props.current;
        const s = (brush / (N - 1)) * dims().D;
        ring.visible = true; ring.position.set(h.point.x, h.point.y + 0.3, h.point.z); ring.scale.set(s * aspect, s, 1);
      } else ring.visible = false;
      const lineH = drawing && props.current.drawLine ? hitLand(e) : undefined;
      if (lineH) { const g = toGrid(lineH.point); props.current.onStroke(g.x, g.y, false); }
      else if (drawing && h) { const g = toGrid(h.point); pending = { x: g.x, y: g.y }; if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) props.current.onStroke(pending.x, pending.y, false); }); }
      render();
    };
    const up = () => {
      if (moving) { moving = null; controls.enabled = true; props.current.onStrokeEnd(); }
      if (drawing) { drawing = false; props.current.onStrokeEnd(); }
    };
    const leave = () => { ring.visible = false; render(); };
    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', down); dom.addEventListener('pointermove', move); dom.addEventListener('pointerup', up); dom.addEventListener('pointerleave', leave);

    return () => {
      ro.disconnect(); controls.dispose(); cancelAnimationFrame(rq); cancelAnimationFrame(walkRaf); clearTimeout(S.current?.miniT);
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur);
      dom.removeEventListener('pointerdown', down); dom.removeEventListener('pointermove', move); dom.removeEventListener('pointerup', up); dom.removeEventListener('pointerleave', leave);
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.(); });
      S.current?.tex?.dispose();
      renderer.dispose(); el.innerHTML = '';
      S.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** height (in 3D units) at a grid point */
  const heightAt = (u: number, v: number) => {
    const { N, heights, heightScale } = props.current;
    const gx = Math.max(0, Math.min(N - 1, Math.round(u * (N - 1)))), gy = Math.max(0, Math.min(N - 1, Math.round(v * (N - 1))));
    return heights[gy * N + gx] * heightScale;
  };

  // ---- the land: build the tiles when the size changes, then refresh only the tiles that changed
  const geoKey = `${p.N}:${p.aspect}`;
  useEffect(() => {
    const s = S.current!; const { N } = p; const { W, D, S0 } = dims();
    for (const c of s.chunks) { s.land.remove(c.mesh); c.mesh.geometry.dispose(); }
    s.chunks = [];
    for (let y0 = 0; y0 < N - 1; y0 += TILE) for (let x0 = 0; x0 < N - 1; x0 += TILE) {
      const x1 = Math.min(N - 1, x0 + TILE), y1 = Math.min(N - 1, y0 + TILE);
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(w * h * 3);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = (j * w + i) * 3;
        pos[k] = ((x0 + i) / (N - 1) - 0.5) * W; pos[k + 2] = ((y0 + j) / (N - 1) - 0.5) * D;
      }
      const idx: number[] = [];
      for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; idx.push(a, c, b, b, c, d); }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(w * h * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(w * h * 3), 3));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, s.material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      s.land.add(mesh); s.chunks.push({ mesh, x0, y0, x1, y1 });
    }
    // a small map fits on the screen; bigger maps start at the same view and can't be zoomed out further,
    // so you travel across them (right-drag, arrow keys or the overview map)
    const big = isBig(N);
    const F = Math.min(S0, SMALL);
    s.controls.maxDistance = big ? Math.min(S0 * 3.2, SMALL * 4.5) : S0 * 3.2;
    s.ripples.repeat.set((W / 3), (D / 3));
    s.mini.hidden = !big;
    if (big) {
      const dpr = Math.min(2, window.devicePixelRatio || 1), mw = 160, mh = Math.round(160 / p.aspect);
      for (const c of s.mini.querySelectorAll('canvas')) { c.width = mw * dpr; c.height = mh * dpr; }
      s.mini.style.width = mw + 'px'; s.mini.style.height = mh + 'px';
      s.drawMiniBase();
    }
    // a tall screen (a phone) looks down more steeply so the land fills it
    const tall = (host.current?.clientHeight ?? 0) > (host.current?.clientWidth ?? 1) * 1.1;
    s.camera.position.set(0, F * (tall ? 1.3 : 0.85), F * (tall ? 0.62 : 1.1)); s.controls.target.set(0, 0, 0); s.controls.update();
    s.controls.dispatchEvent({ type: 'change' });
    s.follow();
    s.drawMiniMark();
    p.dirtyRef.current = null;
  }, [geoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = S.current!; const { N, heights, paint, sea, heightScale: hs, lowPoly } = p; const { W, D } = dims();
    if (heights.length !== N * N) return;
    // redraw only what changed: the brush area, or everything when the sea, height or look changed
    const last = lastLook.current;
    const rect = last.sea !== sea || last.hs !== hs || last.lowPoly !== lowPoly ? null : p.dirtyRef.current;
    lastLook.current = { sea, hs, lowPoly };
    p.dirtyRef.current = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const dx = W / (N - 1), dz = D / (N - 1);
    const H = (x: number, y: number) => heights[Math.max(0, Math.min(N - 1, y)) * N + Math.max(0, Math.min(N - 1, x))] * hs;
    for (const c of s.chunks) {
      if (rect && (c.x1 < rect.x0 - 1 || c.x0 > rect.x1 + 1 || c.y1 < rect.y0 - 1 || c.y0 > rect.y1 + 1)) continue;
      const g = c.mesh.geometry as THREE.BufferGeometry;
      const pos = (g.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const nor = (g.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
      const col = (g.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
      const w = c.x1 - c.x0 + 1;
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
        const k = ((y - c.y0) * w + (x - c.x0)) * 3, i = y * N + x;
        pos[k + 1] = heights[i] * hs;
        // smooth normals straight from the heights, so tiles join without seams
        const nx = -(H(x + 1, y) - H(x - 1, y)) / (2 * dx), nz = -(H(x, y + 1) - H(x, y - 1)) / (2 * dz);
        const l = Math.hypot(nx, 1, nz); nor[k] = nx / l; nor[k + 1] = 1 / l; nor[k + 2] = nz / l;
        const [r, gg, b] = cellColor(heights[i], paint[i], sea, slopeAt(heights, N, x, y, hs));
        const j = heights[i] >= sea ? colorJitter(x, y) : 1;
        col[k] = (Math.min(255, r * j) / 255) ** 2.2; col[k + 1] = (Math.min(255, gg * j) / 255) ** 2.2; col[k + 2] = (Math.min(255, b * j) / 255) ** 2.2;
      }
      g.getAttribute('position').needsUpdate = true; g.getAttribute('normal').needsUpdate = true; g.getAttribute('color').needsUpdate = true;
      g.computeBoundingSphere(); g.computeBoundingBox();
    }
    if (s.material.flatShading !== lowPoly) { s.material.flatShading = lowPoly; s.material.needsUpdate = true; }
    // floor of the block: a little below the deepest point
    let lo = Infinity; for (let i = 0; i < N * N; i++) if (heights[i] < lo) lo = heights[i];
    const base = Math.min(lo, sea, 0) * hs - Math.max(2, hs * 0.12);
    buildSkirt(s.skirt, N, heights, hs, base, W, D);
    const top = sea * hs;
    s.water.visible = sea > 0 && top > base;
    // a hair smaller than the land so the earth walls never flicker through it
    s.water.scale.set(W * 0.998, Math.max(0.01, top - base - 0.05), D * 0.998);
    s.water.position.y = (top + base + 0.05) / 2;
    // the overview map catches up once the brush rests
    clearTimeout(s.miniT); s.miniT = window.setTimeout(() => S.current?.drawMiniBase(), rect ? 400 : 0);
    s.render();
  }, [p.version, p.sea, p.heightScale, p.lowPoly, geoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- picture draped over the terrain
  useEffect(() => {
    const s = S.current!; const mat = s.material;
    s.tex?.dispose(); s.tex = undefined;
    // each tile needs picture coordinates for its part of the map
    const { N } = p;
    for (const c of s.chunks) {
      const g = c.mesh.geometry as THREE.BufferGeometry; const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
      const uv = new Float32Array(w * h * 2);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = (j * w + i) * 2; uv[k] = (c.x0 + i) / (N - 1); uv[k + 1] = 1 - (c.y0 + j) / (N - 1); }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    if (p.useImage && p.image) {
      new THREE.TextureLoader().load(p.image, (t) => {
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
        if (!S.current) return;
        S.current.tex = t; mat.map = t; mat.vertexColors = false; mat.needsUpdate = true; S.current.render();
      });
    } else { mat.map = null; mat.vertexColors = true; mat.needsUpdate = true; s.render(); }
  }, [p.useImage, p.image, geoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pins
  useEffect(() => {
    const s = S.current!; const { pins, selectedPin, sea, heightScale } = p; const { W, D, S0 } = dims();
    void S0;
    s.pins.children.slice().forEach((c) => { s.pins.remove(c); c.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); (o as THREE.Mesh).geometry?.dispose(); }); });
    for (const pin of pins) {
      const grp = new THREE.Group();
      grp.position.set((pin.u - 0.5) * W, Math.max(heightAt(pin.u, pin.v), sea * heightScale), (pin.v - 0.5) * D);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 6), new THREE.MeshStandardMaterial({ color: 0xf0f0f0 }));
      stick.position.y = 2.5;
      const head = new THREE.Mesh(new THREE.SphereGeometry(pin.id === selectedPin ? 1.2 : 0.9, 16, 12), new THREE.MeshStandardMaterial({ color: pin.color, emissive: pin.color, emissiveIntensity: 0.25 }));
      head.position.y = 5.4;
      const div = document.createElement('button');
      div.className = 'map-label' + (pin.id === selectedPin ? ' on' : '');
      div.textContent = pin.label || 'Pin';
      div.onclick = () => props.current.onSelectPin(pin.id);
      const lbl = new CSS2DObject(div); lbl.position.y = 7.4;
      grp.add(stick, head, lbl);
      s.pins.add(grp);
    }
    s.follow();
    s.render();
  }, [p.pins, p.selectedPin, p.version, p.heightScale, p.sea, geoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** the exact height of the land surface (in 3D units) at u,v: follows the same triangles the land is drawn with */
  const surfaceAt = (u: number, v: number) => {
    const { N, heights, heightScale } = props.current;
    const fx0 = Math.max(0, Math.min(N - 1.0001, u * (N - 1))), fy0 = Math.max(0, Math.min(N - 1.0001, v * (N - 1)));
    const x = Math.floor(fx0), y = Math.floor(fy0), fx = fx0 - x, fy = fy0 - y;
    const a = heights[y * N + x], b = heights[y * N + x + 1], c = heights[(y + 1) * N + x], d = heights[(y + 1) * N + x + 1];
    const h = fx + fy <= 1 ? a + (b - a) * fx + (c - a) * fy : d + (c - d) * (1 - fx) + (b - d) * (1 - fy);
    return h * heightScale;
  };
  surfaceRef.current = surfaceAt;

  // ---- placed things (houses, walls, trees…), drawn with one instanced mesh per part for speed
  useEffect(() => {
    const s = S.current!; const { objects, selectedObject, pendingLine, sea, heightScale } = p; const { W, D } = dims();
    s.objects.children.slice().forEach((c) => { s.objects.remove(c); const m = c as THREE.InstancedMesh; m.dispose?.(); });
    s.owners.clear();
    const parts = new Map<string, { geo: THREE.BufferGeometry; mats: THREE.Matrix4[]; colors: THREE.Color[]; ids: string[] }>();
    const add = (key: string, geo: () => THREE.BufferGeometry, m: THREE.Matrix4, color: string, id: string) => {
      let e = parts.get(key); if (!e) { e = { geo: SHARED[key] ??= geo(), mats: [], colors: [], ids: [] }; parts.set(key, e); }
      e.mats.push(m); e.colors.push(new THREE.Color(color)); e.ids.push(id);
    };
    const place = (u: number, v: number) => new THREE.Vector3((u - 0.5) * W, surfaceAt(u, v), (v - 0.5) * D);
    const q = (rot: number) => new THREE.Quaternion().setFromAxisAngle(UP, rot);
    const M = (pos: THREE.Vector3, rot: number, sc: number, local: THREE.Matrix4) => new THREE.Matrix4().compose(pos, q(rot), new THREE.Vector3(sc, sc, sc)).multiply(local);
    for (const o of objects) {
      const def = objDef(o.kind), base = o.color ?? def.color, k = o.scale * def.real;
      if (def.stroke) continue; // drawn separately below
      if (def.line) {
        if (o.u2 === undefined || o.v2 === undefined) continue;
        const a = place(o.u, o.v), b = place(o.u2, o.v2);
        const len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 0.01) continue;
        const rot = -Math.atan2(b.z - a.z, b.x - a.x);
        if (o.kind === 'bridge') {
          // a bridge is flat, at least above the water
          const y = Math.max(a.y, b.y, sea * heightScale) + 0.35 * k;
          const c = new THREE.Vector3((a.x + b.x) / 2, y, (a.z + b.z) / 2);
          add('plank', () => new THREE.BoxGeometry(1, 0.25, 1.4), new THREE.Matrix4().compose(c, q(rot), new THREE.Vector3(len, k, k)), base, o.id);
          for (const side of [-0.65, 0.65]) add('rail', () => new THREE.BoxGeometry(1, 0.3, 0.1).translate(0, 0.3, 0), new THREE.Matrix4().compose(c.clone().add(new THREE.Vector3(0, 0, side * k).applyAxisAngle(UP, rot)), q(rot), new THREE.Vector3(len, k, k)), '#6b4f35', o.id);
          continue;
        }
        // walls and fences follow the ground in short pieces (longer pieces on very long lines)
        const piece = Math.max(1.5 * k, len / 300), n = Math.max(1, Math.ceil(len / piece));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n; const c = place(o.u + (o.u2 - o.u) * t, o.v + (o.v2 - o.v) * t);
          const along = new THREE.Vector3(len / n + 0.01 * k, k, k);
          if (o.kind === 'wall') {
            add('wall', () => new THREE.BoxGeometry(1, 1.6, 0.5).translate(0, 0.6, 0), new THREE.Matrix4().compose(c, q(rot), along), base, o.id);
            if (i % 2 === 0) add('crenel', () => new THREE.BoxGeometry(0.35, 0.35, 0.55).translate(0, 1.55, 0), M(c, rot, k, T()), base, o.id);
          } else {
            add('fence-rail', () => new THREE.BoxGeometry(1, 0.06, 0.06).translate(0, 0.16, 0), new THREE.Matrix4().compose(c, q(rot), along), base, o.id);
            add('fence-rail2', () => new THREE.BoxGeometry(1, 0.06, 0.06).translate(0, 0.28, 0), new THREE.Matrix4().compose(c, q(rot), along), base, o.id);
            add('fence-post', () => new THREE.BoxGeometry(0.08, 0.34, 0.08).translate(0, 0.14, 0), M(c, rot, k, T()), base, o.id);
          }
        }
        continue;
      }
      const at = place(o.u, o.v);
      for (const part of SHAPES[o.kind] ?? []) add(part.key, part.geo, M(at, o.rot, k, part.local), part.color === 'main' ? base : part.color, o.id);
    }
    for (const [key, e] of parts) {
      const im = new THREE.InstancedMesh(e.geo, MATERIAL, e.mats.length);
      e.mats.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, e.colors[i].convertSRGBToLinear()); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere(); im.name = key; im.castShadow = true; im.receiveShadow = true;
      s.objects.add(im); s.owners.set(im, e.ids);
    }

    // ---- drawn lines: dirt paths, roads, streets and rivers, laid over the land like ribbons
    s.strokes.children.slice().forEach((c) => { s.strokes.remove(c); (c as THREE.Mesh).geometry.dispose(); });
    const byMat = new Map<string, { pos: number[]; col: number[]; idx: number[] }>();
    for (const o of objects) {
      const def = objDef(o.kind); if (!def.stroke) continue;
      const raw = strokePts(o); if (raw.length < 2) continue;
      const w = strokeWidth(o), lift = 0.006 + w * 0.04;
      // smooth the drawn line, then step along it about every 10 m so it hugs the ground
      const sm = smoothLine(raw.map(([u, v]) => [(u - 0.5) * W, (v - 0.5) * D] as [number, number]), 5);
      const pts: [number, number][] = [sm[0]];
      const step = Math.min(0.25, Math.max(0.06, w * 0.5));
      for (let i = 1; i < sm.length; i++) {
        const [px, pz] = pts[pts.length - 1], [x, z] = sm[i], L = Math.hypot(x - px, z - pz);
        const n = Math.floor(L / step);
        for (let j = 1; j <= n; j++) pts.push([px + ((x - px) * j * step) / L, pz + ((z - pz) * j * step) / L]);
        if (L - n * step > step * 0.3 || i === sm.length - 1) pts.push([x, z]);
      }
      if (pts.length < 2) continue;
      const key = o.kind === 'river' ? 'water' : 'ground';
      let e = byMat.get(key); if (!e) { e = { pos: [], col: [], idx: [] }; byMat.set(key, e); }
      const c = new THREE.Color(o.color ?? def.color).convertSRGBToLinear();
      const start = e.pos.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const [x0, z0] = pts[Math.max(0, i - 1)], [x1, z1] = pts[Math.min(pts.length - 1, i + 1)];
        let tx = x1 - x0, tz = z1 - z0; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const [x, z] = pts[i];
        for (const side of [1, -1]) {
          const sx = x - tz * (w / 2) * side, sz = z + tx * (w / 2) * side;
          const y = Math.max(surfaceAt(sx / W + 0.5, sz / D + 0.5), o.kind === 'river' ? -Infinity : -Infinity) + lift;
          e.pos.push(sx, y, sz); e.col.push(c.r, c.g, c.b);
        }
        if (i > 0) { const a = start + (i - 1) * 2; e.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
    }
    for (const [key, e] of byMat) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(e.pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(e.col, 3));
      g.setIndex(e.idx); g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, key === 'water' ? RIVER_MAT : ROAD_MAT);
      mesh.receiveShadow = true; mesh.renderOrder = 1;
      s.strokes.add(mesh);
    }

    // selection ring / where a wall starts
    const sel = objects.find((o) => o.id === selectedObject);
    const mid = (o: MapObject) => {
      if (o.pts) { const ps = strokePts(o); const m = ps[Math.floor(ps.length / 2)] ?? [o.u, o.v]; return { u: m[0], v: m[1] }; }
      return { u: o.u2 !== undefined ? (o.u + o.u2) / 2 : o.u, v: o.v2 !== undefined ? (o.v + (o.v2 ?? o.v)) / 2 : o.v };
    };
    const mk = pendingLine ?? (sel ? mid(sel) : null);
    s.marker.visible = !!mk;
    if (mk) {
      const c = place(mk.u, mk.v); const def = sel ? objDef(sel.kind) : null;
      const r = pendingLine || !sel || !def ? 0.12 : def.stroke ? strokeWidth(sel) : Math.max(0.08, 0.65 * Math.max(...(def.fp ?? [2, 2])) * def.real * sel.scale);
      s.marker.position.set(c.x, c.y + 0.05, c.z); s.marker.scale.setScalar(r / 1.7);
    }
    s.render();
  }, [p.objects, p.selectedObject, p.pendingLine, p.version, p.heightScale, p.sea, geoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- journeys: where characters travel, as coloured dashed lines with a dot at each stop
  useEffect(() => {
    const s = S.current!; const { W, D } = dims();
    s.journeys.children.slice().forEach((c) => { s.journeys.remove(c); c.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); }); const l = c as Line2; l.geometry?.dispose(); (l.material as THREE.Material | undefined)?.dispose?.(); });
    const size = new THREE.Vector2(); s.renderer.getSize(size);
    for (const j of p.journeys) {
      if (!j.stops.length) continue;
      const lift = 0.15;
      const at = (u: number, v: number) => new THREE.Vector3((u - 0.5) * W, surfaceAt(u, v) + lift, (v - 0.5) * D);
      if (j.stops.length > 1) {
        // follow the ground between stops
        const sm = smoothLine(j.stops.map((x) => [x.u, x.v] as [number, number]), 24);
        const flat: number[] = [];
        for (const [u, v] of sm) { const q = at(u, v); flat.push(q.x, Math.max(q.y, p.sea * p.heightScale + lift), q.z); }
        const g = new LineGeometry(); g.setPositions(flat);
        const m = new LineMaterial({ color: new THREE.Color(j.color).getHex(), linewidth: j.selected ? 4 : 3, dashed: true, dashSize: 1, gapSize: 0.6, worldUnits: false, transparent: true, opacity: 0.95, depthTest: false });
        m.resolution.set(size.x, size.y);
        const line = new Line2(g, m); line.computeLineDistances(); line.renderOrder = 12;
        // dashes about the same on screen whatever the map size
        const scale = Math.max(0.4, worldSize(p.N) / 120); m.dashSize = scale; m.gapSize = scale * 0.6;
        s.journeys.add(line);
      }
      j.stops.forEach((st, i) => {
        const el = document.createElement('div');
        const last = i === j.stops.length - 1;
        el.className = 'map-jstop' + (last ? ' head' : '');
        el.style.setProperty('--jc', j.color);
        if (last) el.textContent = j.name;
        const o = new CSS2DObject(el); const q = at(st.u, st.v); o.position.copy(q);
        s.journeys.add(o);
      });
    }
    s.render();
  }, [p.journeys, p.version, p.heightScale, p.sea, geoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // tool changes: left button sculpts instead of orbiting (right button still orbits)
  useEffect(() => {
    const c = S.current!.controls;
    c.mouseButtons = { LEFT: p.tool === 'view' ? THREE.MOUSE.ROTATE : (-1 as unknown as THREE.MOUSE), MIDDLE: THREE.MOUSE.DOLLY, RIGHT: p.tool === 'view' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE };
    S.current!.renderer.domElement.style.cursor = p.tool === 'view' ? 'grab' : p.tool === 'pin' || p.tool === 'object' || p.tool === 'journey' ? 'crosshair' : p.tool === 'select' ? 'pointer' : 'none';
    S.current!.ring.visible = false; S.current!.render();
  }, [p.tool]);

  return <div className="terrain3d" ref={host} />;
}

/* ---------- shapes of the things you can place (sizes in 3D units; a map cell is 0.63) ---------- */
const UP = new THREE.Vector3(0, 1, 0);
const MATERIAL = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true });
const SHARED: Record<string, THREE.BufferGeometry> = {};
const T = (x = 0, y = 0, z = 0, sy = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(1, sy, 1));
const box = (w: number, h: number, d: number) => () => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
const roof = (r: number, h: number) => () => new THREE.ConeGeometry(r, h, 4).rotateY(Math.PI / 4).translate(0, h / 2, 0);
const cyl = (r: number, h: number, seg = 8) => () => new THREE.CylinderGeometry(r, r, h, seg).translate(0, h / 2, 0);
const cone = (r: number, h: number, seg = 8) => () => new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0);
type Part = { key: string; geo: () => THREE.BufferGeometry; local: THREE.Matrix4; color: string };
const gable = (w: number, h: number, d: number) => () => {
  // a pitched roof: a triangular prism along the depth
  const shape = new THREE.Shape(); shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2);
};
const SHAPES: Record<string, Part[]> = {
  house: [{ key: 'house-body', geo: box(2.4, 1.6, 2), local: T(), color: 'main' }, { key: 'house-roof', geo: roof(1.9, 1.3), local: T(0, 1.6), color: '#8c3b2e' }],
  cottage: [{ key: 'cottage-body', geo: box(1.6, 1.1, 1.4), local: T(), color: 'main' }, { key: 'cottage-roof', geo: roof(1.35, 1.1), local: T(0, 1.1), color: '#b8953c' }],
  barn: [{ key: 'barn-body', geo: box(2.2, 1.8, 3.2), local: T(), color: 'main' }, { key: 'barn-roof', geo: gable(2.6, 1.3, 3.4), local: T(0, 1.8), color: '#5a4a3c' }],
  tower: [{ key: 'tower-body', geo: cyl(0.8, 4.2, 10), local: T(), color: 'main' }, { key: 'tower-roof', geo: cone(1.05, 1.7, 10), local: T(0, 4.2), color: '#4b5d7a' }],
  castle: [
    { key: 'keep', geo: box(3.6, 3, 3.6), local: T(), color: 'main' },
    ...[[-2, -2], [2, -2], [2, 2], [-2, 2]].flatMap(([x, z], i) => [
      { key: 'ctower', geo: cyl(0.75, 4.2, 10), local: T(x, 0, z), color: 'main' },
      { key: 'ctower-roof', geo: cone(0.95, 1.4, 10), local: T(x, 4.2, z), color: i % 2 ? '#4b5d7a' : '#7a3b3b' },
    ]),
    { key: 'keep-roof', geo: roof(2.8, 1.6), local: T(0, 3), color: '#4b5d7a' },
  ],
  temple: [
    { key: 'temple-base', geo: box(3.2, 0.4, 4.4), local: T(), color: 'main' },
    ...[-1.2, 1.2].flatMap((x) => [-1.7, -0.6, 0.6, 1.7].map((z) => ({ key: 'temple-col', geo: cyl(0.16, 1.8, 8), local: T(x, 0.4, z), color: 'main' }))),
    { key: 'temple-top', geo: box(3.2, 0.3, 4.4), local: T(0, 2.2), color: 'main' },
    { key: 'temple-roof', geo: gable(3.4, 0.9, 4.6), local: T(0, 2.5), color: '#a8957a' },
  ],
  windmill: [
    { key: 'mill-body', geo: () => new THREE.CylinderGeometry(0.55, 0.8, 3.4, 8).translate(0, 1.7, 0), local: T(), color: 'main' },
    { key: 'mill-cap', geo: cone(0.75, 0.8, 8), local: T(0, 3.4), color: '#5a4a3c' },
    { key: 'mill-blade', geo: () => new THREE.BoxGeometry(0.28, 3.6, 0.05), local: new THREE.Matrix4().compose(new THREE.Vector3(0, 3.2, 0.82), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4), new THREE.Vector3(1, 1, 1)), color: '#6b4f35' },
    { key: 'mill-blade', geo: () => new THREE.BoxGeometry(0.28, 3.6, 0.05), local: new THREE.Matrix4().compose(new THREE.Vector3(0, 3.2, 0.82), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 4), new THREE.Vector3(1, 1, 1)), color: '#6b4f35' },
  ],
  lighthouse: [
    { key: 'lh-body', geo: () => new THREE.CylinderGeometry(0.45, 0.7, 4.4, 12).translate(0, 2.2, 0), local: T(), color: 'main' },
    { key: 'lh-band', geo: () => new THREE.CylinderGeometry(0.56, 0.6, 0.6, 12).translate(0, 2.2, 0), local: T(), color: '#b8423a' },
    { key: 'lh-light', geo: cyl(0.4, 0.6, 10), local: T(0, 4.4), color: '#ffe9a8' },
    { key: 'lh-roof', geo: cone(0.55, 0.6, 10), local: T(0, 5), color: '#b8423a' },
  ],
  tent: [{ key: 'tent', geo: cone(1.1, 1.3, 6), local: T(), color: 'main' }],
  well: [{ key: 'well', geo: cyl(0.55, 0.6, 10), local: T(), color: 'main' }, { key: 'well-roof', geo: roof(0.75, 0.5), local: T(0, 1.2), color: '#8c3b2e' }, { key: 'well-post', geo: box(0.08, 1.2, 0.9), local: T(), color: '#6b4f35' }],
  ruins: [
    { key: 'ruin-a', geo: box(3.2, 1.4, 0.35), local: T(0, 0, -1.3), color: 'main' },
    { key: 'ruin-b', geo: box(0.35, 0.8, 2.4), local: T(-1.4, 0, 0), color: 'main' },
    { key: 'ruin-c', geo: box(1.2, 2.1, 0.35), local: T(1, 0, 1.2), color: 'main' },
    { key: 'ruin-col', geo: cyl(0.2, 1.7, 8), local: T(0.6, 0, -0.2), color: 'main' },
    { key: 'ruin-stone', geo: () => new THREE.DodecahedronGeometry(0.35, 0).translate(0, 0.2, 0), local: T(-0.4, 0, 0.6), color: 'main' },
  ],
  statue: [{ key: 'statue-base', geo: box(1.1, 0.7, 1.1), local: T(), color: '#9a958c' }, { key: 'statue-body', geo: () => new THREE.CylinderGeometry(0.22, 0.32, 1.5, 8).translate(0, 1.45, 0), local: T(), color: 'main' }, { key: 'statue-head', geo: () => new THREE.SphereGeometry(0.22, 10, 8).translate(0, 2.4, 0), local: T(), color: 'main' }],
  boat: [
    { key: 'boat-hull', geo: () => { const sh = new THREE.Shape(); sh.moveTo(-1.5, 0.45); sh.lineTo(1.5, 0.45); sh.lineTo(1.1, 0); sh.lineTo(-1.1, 0); sh.closePath(); return new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: false }).translate(0, 0, -0.45); }, local: T(), color: 'main' },
    { key: 'boat-mast', geo: cyl(0.05, 2.4, 6), local: T(0, 0.45), color: '#6b4f35' },
    { key: 'boat-sail', geo: () => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, 1.9); sh.lineTo(1.1, 0); sh.closePath(); return new THREE.ShapeGeometry(sh).translate(0.08, 0.7, 0); }, local: T(), color: '#efe8da' },
  ],
  flag: [{ key: 'flag-pole', geo: cyl(0.06, 3, 6), local: T(), color: '#e8e2d6' }, { key: 'flag-cloth', geo: () => new THREE.BoxGeometry(1.2, 0.7, 0.05).translate(0.6, 2.6, 0), local: T(), color: 'main' }],
  tree: [{ key: 'trunk', geo: cyl(0.15, 1, 6), local: T(), color: '#6b4f35' }, { key: 'tree-top', geo: () => new THREE.IcosahedronGeometry(0.95, 0).translate(0, 1.6, 0), local: T(), color: 'main' }],
  pine: [{ key: 'trunk', geo: cyl(0.15, 1, 6), local: T(), color: '#6b4f35' }, { key: 'pine-top', geo: cone(0.85, 2.4, 7), local: T(0, 0.6), color: 'main' }],
  bush: [{ key: 'bush', geo: () => new THREE.IcosahedronGeometry(0.7, 0).translate(0, 0.45, 0), local: T(0, 0, 0, 0.75), color: 'main' }],
  rock: [{ key: 'rock', geo: () => new THREE.DodecahedronGeometry(0.8, 0).translate(0, 0.3, 0), local: T(0, 0, 0, 0.65), color: 'main' }],
};
const ROAD_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const RIVER_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

/** the sky behind everything: a vertical gradient */
function skyTexture() {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const g = c.getContext('2d')!; const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, SKY_TOP); gr.addColorStop(0.6, HORIZON); gr.addColorStop(0.75, HORIZON); gr.addColorStop(1, '#93a5b5');
  g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** small ripples for the water's surface (a tiling bump texture), so the sun glints off it */
function rippleTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = S; c.height = S;
  const g = c.getContext('2d')!; const img = g.createImageData(S, S);
  const hgt = (x: number, y: number) => {
    const a = (2 * Math.PI) / S;
    return Math.sin(x * a * 3 + Math.sin(y * a * 2) * 1.3) * 0.5 + Math.sin(y * a * 5 + Math.cos(x * a * 3) * 1.1) * 0.35 + Math.sin((x + y) * a * 7) * 0.15;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
    const n = new THREE.Vector3(-dx, -dy, 1).normalize(); const i = (y * S + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

/** Earth walls around the four edges of the terrain, down to a flat floor */
function buildSkirt(mesh: THREE.Mesh, N: number, heights: Float32Array, hs: number, base: number, W: number, D: number) {
  const edges: [number, number][][] = [[], [], [], []];
  for (let k = 0; k < N; k++) {
    edges[0].push([k, 0]); edges[1].push([N - 1, k]); edges[2].push([N - 1 - k, N - 1]); edges[3].push([0, N - 1 - k]);
  }
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const topC = [0.30, 0.21, 0.14], botC = [0.11, 0.08, 0.06];
  const lin = (c: number[]) => c.map((v) => v ** 2.2);
  const [tc, bc] = [lin(topC), lin(botC)];
  for (const edge of edges) {
    const start = pos.length / 3;
    for (const [gx, gy] of edge) {
      const x = (gx / (N - 1) - 0.5) * W, z = (gy / (N - 1) - 0.5) * D;
      const y = heights[gy * N + gx] * hs;
      pos.push(x, y, z, x, base, z);
      col.push(...tc, ...bc);
    }
    for (let k = 0; k < N - 1; k++) {
      const a = start + k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
  }
  // the floor
  const f = pos.length / 3;
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]]) { pos.push(x, base, z); col.push(...bc); }
  idx.push(f, f + 1, f + 2, f, f + 2, f + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  mesh.geometry.dispose(); mesh.geometry = g;
}
