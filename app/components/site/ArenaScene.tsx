"use client";
/**
 * Hero scene: a stylised arena. Tiers of glowing pillars form a bowl, agents
 * (points of light) circle the floor and dash at the prize in the middle.
 * Pure decoration: no data. Pauses when off screen; one still frame when the
 * visitor prefers reduced motion.
 */
import { useEffect, useRef } from "react";
import { useTheme } from "@/components/ThemeProvider";
import * as THREE from "three";

const ORANGE = new THREE.Color("#ff5a1f");
const GOLD = new THREE.Color("#f5b83d");
const WHITE = new THREE.Color("#fff3e6");

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.7)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function floorTexture(light = false): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  if (light) {
    // Sand floor, warm and sunlit, with an orange heart under the prize.
    grd.addColorStop(0, "rgba(255,138,72,0.95)");
    grd.addColorStop(0.22, "rgba(255,190,130,0.85)");
    grd.addColorStop(0.6, "rgba(236,214,186,0.9)");
    grd.addColorStop(1, "rgba(226,206,180,0)");
  } else {
    grd.addColorStop(0, "rgba(255,120,50,0.55)");
    grd.addColorStop(0.35, "rgba(255,90,31,0.18)");
    grd.addColorStop(0.75, "rgba(120,60,200,0.06)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = light ? "rgba(150,80,30,0.22)" : "rgba(255,160,90,0.22)";
  g.lineWidth = 1.5;
  for (let r = 40; r < 256; r += 34) { g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath(); g.moveTo(256 + Math.cos(a) * 40, 256 + Math.sin(a) * 40); g.lineTo(256 + Math.cos(a) * 250, 256 + Math.sin(a) * 250); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function ArenaScene({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const light = theme === "light";

  useEffect(() => {
    // Two looks: a night arena lit from inside (dark) and a sunlit sandstone colosseum (light).
    const P = light
      ? { fog: 0xf7f3ee, fogNear: 12, fogFar: 27, add: THREE.NormalBlending, pillar: 0xeadcc8, pillarEm: 0x000000, ledge: 0xdcc9b1, ringOpacity: 0.9, haloOpacity: 0.32, beamOpacity: 0.14, dust: 0xb98a5c, dustOpacity: 0.45, coreI: 14 }
      : { fog: 0x110f0d, fogNear: 11, fogFar: 24, add: THREE.AdditiveBlending, pillar: 0x1c1814, pillarEm: 0x2a1408, ledge: 0x16130f, ringOpacity: 0.55, haloOpacity: 0.9, beamOpacity: 0.12, dust: 0xffd2b0, dustOpacity: 0.5, coreI: 30 };
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      return; // no WebGL: the CSS glow behind stays as the fallback
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(P.fog, P.fogNear, P.fogFar);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const target = new THREE.Vector3(0, 0.55, 0);

    // Lights
    if (light) {
      scene.add(new THREE.HemisphereLight(0xfffaf2, 0xd2b896, 1.25));
      const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
      sun.position.set(6, 9, 5);
      scene.add(sun);
    } else {
      scene.add(new THREE.AmbientLight(0x6a5a8a, 0.55));
    }
    const core = new THREE.PointLight(ORANGE, P.coreI, 14, 1.6);
    core.position.set(0, 1.4, 0);
    scene.add(core);
    const rim = new THREE.DirectionalLight(light ? 0xffb37a : 0x8a7dff, light ? 0.5 : 0.6);
    rim.position.set(-6, 6, -4);
    scene.add(rim);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.1, 96),
      new THREE.MeshBasicMaterial({ map: floorTexture(light), transparent: true, depthWrite: false, blending: P.add })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    // Tiers: instanced pillars + a glowing ring on top of each tier
    const arena = new THREE.Group();
    scene.add(arena);
    const pillarGeo = new THREE.BoxGeometry(0.09, 1, 0.09);
    const pillarMat = new THREE.MeshStandardMaterial({ color: P.pillar, emissive: P.pillarEm, roughness: light ? 0.85 : 0.55, metalness: light ? 0.02 : 0.35 });
    const ringMats: THREE.MeshBasicMaterial[] = [];
    const tiers = 5;
    for (let i = 0; i < tiers; i++) {
      const radius = 3.35 + i * 0.62;
      const base = i * 0.42;
      const h = 0.42 + i * 0.05;
      const count = 30 + i * 9;
      const inst = new THREE.InstancedMesh(pillarGeo, pillarMat, count);
      const m = new THREE.Matrix4();
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2;
        m.compose(
          new THREE.Vector3(Math.cos(a) * radius, base + h / 2, Math.sin(a) * radius),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, 0)),
          new THREE.Vector3(1, h, 1)
        );
        inst.setMatrixAt(k, m);
      }
      arena.add(inst);
      const ringMat = new THREE.MeshBasicMaterial({
        color: i % 2 ? GOLD : ORANGE, transparent: true, opacity: P.ringOpacity - i * 0.07, blending: P.add, depthWrite: false,
      });
      ringMats.push(ringMat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.012, 6, 160), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = base + h;
      arena.add(ring);
      const ledge = new THREE.Mesh(
        new THREE.RingGeometry(radius - 0.05, radius + 0.55, 128, 1),
        new THREE.MeshStandardMaterial({ color: P.ledge, roughness: 0.92, side: THREE.DoubleSide })
      );
      ledge.rotation.x = -Math.PI / 2;
      ledge.position.y = base + h + 0.001;
      arena.add(ledge);
    }

    // Prize: the Cogladius mascot (logo.svg) extruded into 3D, floating above the arena.
    // Coordinates follow logo.svg (200x200 viewBox), recentred and flipped to y-up.
    const prize = new THREE.Group();
    prize.position.copy(target).setY(1.55);
    const logo = new THREE.Group();
    const head = new THREE.Shape();
    head.moveTo(-7, 83);
    head.lineTo(6, 83);
    head.absarc(6, 7, 76, Math.PI / 2, 0, true);
    head.lineTo(82, -52);
    head.absarc(52, -52, 30, 0, -Math.PI / 2, true);
    head.lineTo(-53, -82);
    head.absarc(-53, -52, 30, -Math.PI / 2, -Math.PI, true);
    head.lineTo(-83, 7);
    head.absarc(-7, 7, 76, Math.PI, Math.PI / 2, true);
    const DEPTH = 46;
    const headGeo = new THREE.ExtrudeGeometry(head, { depth: DEPTH, bevelEnabled: true, bevelThickness: 7, bevelSize: 6, bevelSegments: 6, curveSegments: 40 });
    headGeo.translate(0, 0, -DEPTH / 2);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xfe5625, emissive: 0xff4a10, emissiveIntensity: 0.35, metalness: 0.25, roughness: 0.38 });
    logo.add(new THREE.Mesh(headGeo, headMat));
    // Bandana (capsule) and eyes on both faces, so the slow spin always shows a face.
    const band = new THREE.Shape();
    const bx0 = -66, bx1 = 65, by0 = -11, by1 = 21, br = 16;
    band.moveTo(bx0 + br, by0);
    band.lineTo(bx1 - br, by0);
    band.absarc(bx1 - br, by0 + br, br, -Math.PI / 2, Math.PI / 2, false);
    band.lineTo(bx0 + br, by1);
    band.absarc(bx0 + br, by0 + br, br, Math.PI / 2, (3 * Math.PI) / 2, false);
    const bandGeo = new THREE.ExtrudeGeometry(band, { depth: 6, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 3, curveSegments: 24 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x050507, metalness: 0.6, roughness: 0.18 });
    const eyeGeo = new THREE.CylinderGeometry(10.5, 10.5, 6, 40);
    eyeGeo.rotateX(Math.PI / 2);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.4 });
    const eyeGlowTex = glowTexture();
    for (const side of [1, -1]) {
      const z = side * (DEPTH / 2 + 6);
      const b = new THREE.Mesh(bandGeo, bandMat);
      b.position.z = side > 0 ? z - 4 : z - 4;
      if (side < 0) { b.rotation.y = Math.PI; b.position.z = z + 4; }
      logo.add(b);
      for (const ex of [-38, 37]) {
        const e = new THREE.Mesh(eyeGeo, eyeMat);
        e.position.set(side > 0 ? ex : -ex, 5, z + side * 6);
        logo.add(e);
        const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeGlowTex, color: 0xfff1e0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        g.scale.set(60, 60, 1);
        g.position.copy(e.position).add(new THREE.Vector3(0, 0, side * 4));
        logo.add(g);
      }
    }
    logo.scale.setScalar(0.0092);
    prize.add(logo);
    const orbitRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.008, 6, 180),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: light ? 0.8 : 0.45, blending: P.add, depthWrite: false })
    );
    orbitRing.rotation.x = Math.PI / 2.4;
    prize.add(orbitRing);
    const orbitRing2 = orbitRing.clone();
    orbitRing2.rotation.set(Math.PI / 1.8, 0.6, 0);
    (orbitRing2.material as THREE.MeshBasicMaterial) = (orbitRing.material as THREE.MeshBasicMaterial).clone();
    (orbitRing2.material as THREE.MeshBasicMaterial).color = ORANGE.clone();
    prize.add(orbitRing2);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: light ? 0xffa060 : ORANGE, transparent: true, opacity: P.haloOpacity, blending: P.add, depthWrite: false }));
    halo.scale.set(4.2, 4.2, 1);
    halo.position.z = -0.4;
    prize.add(halo);
    scene.add(prize);
    const keyLight = new THREE.SpotLight(0xffe2c8, 40, 14, Math.PI / 7, 0.6, 1.4);
    keyLight.position.set(2.5, 6, 4);
    keyLight.target = prize;
    scene.add(keyLight);

    // Light beam from the floor to the prize
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.55, 1.5, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: P.beamOpacity, blending: P.add, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.set(0, 0.75, 0);
    scene.add(beam);

    // Agents: glowing points that orbit and sometimes dash at the prize
    const N = 140;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const agents = Array.from({ length: N }, (_, i) => {
      const c = light ? [ORANGE, new THREE.Color("#e8930c"), new THREE.Color("#a8461a")][i % 3].clone() : [ORANGE, GOLD, WHITE][i % 3].clone().lerp(WHITE, Math.random() * 0.25);
      col.set([c.r, c.g, c.b], i * 3);
      return {
        a: Math.random() * Math.PI * 2,
        r: 0.9 + Math.random() * 2.0,
        s: (0.12 + Math.random() * 0.35) * (Math.random() < 0.5 ? 1 : -1),
        y: 0.05 + Math.random() * 0.25,
        dash: 0,
        next: 2 + Math.random() * 10,
      };
    });
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    ptsGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(ptsGeo, new THREE.PointsMaterial({
      size: light ? 0.13 : 0.16, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: P.add, sizeAttenuation: true,
    }));
    scene.add(pts);

    // Dust above the arena
    const D = 260;
    const dust = new Float32Array(D * 3);
    for (let i = 0; i < D; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 7;
      dust.set([Math.cos(a) * r, Math.random() * 5, Math.sin(a) * r], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
    const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: light ? 0.03 : 0.035, color: P.dust, transparent: true, opacity: P.dustOpacity, depthWrite: false, blending: P.add }));
    scene.add(dustPts);

    // Sizing
    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.fov = w / h < 0.9 ? 52 : 36;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // Pointer parallax
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 });
    io.observe(el);

    const clock = new THREE.Clock();
    let t = 0;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) { clock.getDelta(); return; }
      const dt = Math.min(clock.getDelta(), 0.05);
      t += dt;
      step(dt);
      renderer.render(scene, camera);
    };

    const step = (dt: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.04;
      pointer.y += (pointer.ty - pointer.y) * 0.04;
      const orbit = t * 0.06 + pointer.x * 0.35;
      const dist = 11.2;
      camera.position.set(Math.sin(orbit) * dist, 5.6 - pointer.y * 0.8, Math.cos(orbit) * dist);
      camera.lookAt(target);

      logo.rotation.y = Math.sin(t * 0.45) * 0.75 + pointer.x * 0.25;
      logo.rotation.x = Math.sin(t * 0.7) * 0.08 - 0.12;
      orbitRing.rotation.z += dt * 0.5;
      orbitRing2.rotation.z -= dt * 0.35;
      prize.position.y = 1.55 + Math.sin(t * 1.6) * 0.09;
      prize.lookAt(camera.position.x, prize.position.y, camera.position.z);
      const pulse = 0.85 + Math.sin(t * 2.2) * 0.15;
      core.intensity = P.coreI * 0.87 * pulse;
      (halo.material as THREE.SpriteMaterial).opacity = P.haloOpacity * (0.72 + 0.28 * pulse);
      ringMats.forEach((m, i) => { m.opacity = (P.ringOpacity - 0.05 - i * 0.07) * (0.75 + 0.25 * Math.sin(t * 1.4 + i)); });

      for (let i = 0; i < N; i++) {
        const g = agents[i];
        g.next -= dt;
        if (g.next <= 0 && g.dash === 0) { g.dash = 0.0001; g.next = 6 + Math.random() * 12; }
        let r = g.r;
        if (g.dash > 0) {
          g.dash += dt * 0.9;
          const k = g.dash < 1 ? Math.sin(g.dash * Math.PI) : 0;
          r = g.r * (1 - 0.82 * k);
          if (g.dash >= 1) g.dash = 0;
        }
        g.a += g.s * dt;
        pos[i * 3] = Math.cos(g.a) * r;
        pos[i * 3 + 1] = g.y + (g.dash > 0 ? Math.sin(g.dash * Math.PI) * 0.6 : 0);
        pos[i * 3 + 2] = Math.sin(g.a) * r;
      }
      ptsGeo.attributes.position.needsUpdate = true;
      dustPts.rotation.y += dt * 0.015;
    };

    if (reduced) {
      step(0.016);
      renderer.render(scene, camera);
    } else {
      frame();
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => {
          (x as THREE.MeshBasicMaterial).map?.dispose?.();
          x.dispose();
        });
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [light]);

  return <div ref={host} className={className} aria-hidden style={{ position: "absolute", inset: 0 }} />;
}
