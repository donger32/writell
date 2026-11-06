import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { cellColor, type Pin, type Tool } from '../../mapdata';

const SIZE = 100;

export interface TerrainProps {
  N: number; heights: Float32Array; paint: Uint8Array; sea: number; heightScale: number; aspect: number;
  image?: string; useImage: boolean; lowPoly: boolean; version: number; tool: Tool; brush: number;
  pins: Pin[]; selectedPin: string | null;
  onStroke: (cx: number, cy: number, first: boolean) => void; onStrokeEnd: () => void;
  onPlacePin: (u: number, v: number) => void; onSelectPin: (id: string) => void;
  snapshotRef?: React.MutableRefObject<(() => string) | null>;
}

/** Sculptable 3D terrain (three.js). Same data as the 2D view. */
export function Terrain3D(p: TerrainProps) {
  const host = useRef<HTMLDivElement>(null);
  const S = useRef<{
    renderer: THREE.WebGLRenderer; labels: CSS2DRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    mesh: THREE.Mesh; water: THREE.Mesh; skirt: THREE.Mesh; ring: THREE.Mesh; pins: THREE.Group; render: () => void; tex?: THREE.Texture;
  } | null>(null);
  const props = useRef(p); props.current = p;

  // ---- set up the scene once
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'map-labels';
    el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#16171b');
    scene.fog = new THREE.Fog(scene.background as THREE.Color, 220, 420);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 2000);
    camera.position.set(0, 85, 110);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3428, 1.1));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6); sun.position.set(-60, 120, 40); scene.add(sun);

    const geo = new THREE.PlaneGeometry(SIZE, SIZE, 1, 1);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    scene.add(mesh);
    // the map is a block of land, like a diorama: earth walls around the sides and underneath,
    // and the sea is a see-through block of water that fills it up to sea level
    const skirt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }));
    scene.add(skirt);
    const water = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x2f6f9f, transparent: true, opacity: 0.55, roughness: 0.25, depthWrite: false }));
    water.renderOrder = 2; scene.add(water);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    ring.rotation.x = -Math.PI / 2; ring.renderOrder = 10; ring.visible = false; scene.add(ring);
    const pins = new THREE.Group(); scene.add(pins);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI * 0.48; controls.minDistance = 15; controls.maxDistance = 400;
    const render = () => { renderer.render(scene, camera); labels.render(scene, camera); };
    controls.addEventListener('change', render);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); labels.setSize(w, h);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); render();
    };
    const ro = new ResizeObserver(resize); ro.observe(el);
    S.current = { renderer, labels, scene, camera, controls, mesh, water, skirt, ring, pins, render };
    if (p.snapshotRef) p.snapshotRef.current = () => { render(); return renderer.domElement.toDataURL('image/png'); };

    // ---- pointer: sculpt / paint / place pins
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
    let drawing = false, pending: { x: number; y: number } | null = null, raf = 0;
    const hit = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObject(mesh)[0];
    };
    const toGrid = (pt: THREE.Vector3) => {
      const { N, aspect } = props.current;
      const u = pt.x / (SIZE * aspect) + 0.5, v = pt.z / SIZE + 0.5;
      return { u, v, x: u * (N - 1), y: v * (N - 1) };
    };
    const down = (e: PointerEvent) => {
      const tool = props.current.tool;
      if (e.button !== 0 || tool === 'view') return;
      const h = hit(e); if (!h) return;
      const g = toGrid(h.point);
      if (tool === 'pin') { props.current.onPlacePin(g.u, g.v); return; }
      drawing = true; renderer.domElement.setPointerCapture(e.pointerId);
      props.current.onStroke(g.x, g.y, true);
    };
    const move = (e: PointerEvent) => {
      const tool = props.current.tool;
      const h = tool !== 'view' ? hit(e) : undefined;
      if (h && tool !== 'pin') {
        const { N, aspect, brush } = props.current;
        const s = (brush / (N - 1)) * SIZE;
        ring.visible = true; ring.position.set(h.point.x, h.point.y + 0.3, h.point.z); ring.scale.set(s * aspect, s, 1);
      } else ring.visible = false;
      if (drawing && h) { const g = toGrid(h.point); pending = { x: g.x, y: g.y }; if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) props.current.onStroke(pending.x, pending.y, false); }); }
      render();
    };
    const up = () => { if (drawing) { drawing = false; props.current.onStrokeEnd(); } };
    const leave = () => { ring.visible = false; render(); };
    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', down); dom.addEventListener('pointermove', move); dom.addEventListener('pointerup', up); dom.addEventListener('pointerleave', leave);

    return () => {
      ro.disconnect(); controls.dispose();
      dom.removeEventListener('pointerdown', down); dom.removeEventListener('pointermove', move); dom.removeEventListener('pointerup', up); dom.removeEventListener('pointerleave', leave);
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mat = m.material as THREE.Material | undefined; mat?.dispose?.(); });
      S.current?.tex?.dispose();
      renderer.dispose(); el.innerHTML = '';
      S.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- (re)build geometry when the grid size / aspect changes
  const geoKey = `${p.N}:${p.aspect}`;
  useEffect(() => {
    const s = S.current!; const { N, aspect } = p;
    s.mesh.geometry.dispose();
    const g = new THREE.PlaneGeometry(SIZE * aspect, SIZE, N - 1, N - 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * N * 3), 3));
    s.mesh.geometry = g;
  }, [geoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- update heights & colours
  useEffect(() => {
    const s = S.current!; const { N, heights, paint, sea, heightScale, lowPoly } = p;
    const g = s.mesh.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    if (!pos || pos.count !== N * N) return;
    for (let i = 0; i < N * N; i++) {
      pos.setY(i, heights[i] * heightScale);
      const [r, gg, b] = cellColor(heights[i], paint[i], sea);
      col.setXYZ(i, (r / 255) ** 2.2, (gg / 255) ** 2.2, (b / 255) ** 2.2);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    g.computeVertexNormals();
    const mat = s.mesh.material as THREE.MeshStandardMaterial;
    mat.flatShading = lowPoly; mat.needsUpdate = true;
    // floor of the block: a little below the deepest point
    let lo = Infinity; for (let i = 0; i < N * N; i++) if (heights[i] < lo) lo = heights[i];
    const base = Math.min(lo, sea, 0) * heightScale - Math.max(2, heightScale * 0.12);
    buildSkirt(s.skirt, N, heights, heightScale, base, p.aspect);
    const top = sea * heightScale;
    s.water.visible = sea > 0 && top > base;
    // a hair smaller than the land so the earth walls never flicker through it
    s.water.scale.set(SIZE * p.aspect * 0.998, Math.max(0.01, top - base - 0.05), SIZE * 0.998);
    s.water.position.y = (top + base + 0.05) / 2;
    s.render();
  }, [p.version, p.sea, p.heightScale, p.lowPoly, geoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- picture draped over the terrain
  useEffect(() => {
    const s = S.current!; const mat = s.mesh.material as THREE.MeshStandardMaterial;
    s.tex?.dispose(); s.tex = undefined;
    if (p.useImage && p.image) {
      new THREE.TextureLoader().load(p.image, (t) => {
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
        if (!S.current) return;
        S.current.tex = t; mat.map = t; mat.vertexColors = false; mat.needsUpdate = true; S.current.render();
      });
    } else { mat.map = null; mat.vertexColors = true; mat.needsUpdate = true; s.render(); }
  }, [p.useImage, p.image]);

  // ---- pins
  useEffect(() => {
    const s = S.current!; const { N, heights, heightScale, aspect, pins, selectedPin } = p;
    s.pins.children.slice().forEach((c) => { s.pins.remove(c); c.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); (o as THREE.Mesh).geometry?.dispose(); }); });
    for (const pin of pins) {
      const gx = Math.round(pin.u * (N - 1)), gy = Math.round(pin.v * (N - 1));
      const hgt = heights[Math.max(0, Math.min(N - 1, gy)) * N + Math.max(0, Math.min(N - 1, gx))] * heightScale;
      const grp = new THREE.Group();
      grp.position.set((pin.u - 0.5) * SIZE * aspect, Math.max(hgt, p.sea * heightScale), (pin.v - 0.5) * SIZE);
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
    s.render();
  }, [p.pins, p.selectedPin, p.version, p.heightScale, p.sea, geoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // tool changes: left button sculpts instead of orbiting (right button still orbits)
  useEffect(() => {
    const c = S.current!.controls;
    c.mouseButtons = { LEFT: p.tool === 'view' ? THREE.MOUSE.ROTATE : (-1 as unknown as THREE.MOUSE), MIDDLE: THREE.MOUSE.DOLLY, RIGHT: p.tool === 'view' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE };
    S.current!.renderer.domElement.style.cursor = p.tool === 'view' ? 'grab' : p.tool === 'pin' ? 'crosshair' : 'none';
  }, [p.tool]);

  return <div className="terrain3d" ref={host} />;
}

/** Earth walls around the four edges of the terrain, down to a flat floor */
function buildSkirt(mesh: THREE.Mesh, N: number, heights: Float32Array, hs: number, base: number, aspect: number) {
  const W = SIZE * aspect, D = SIZE;
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
