import * as THREE from 'three';

/** Mesma ordem de FLAVORS em src/data/products.ts; é também a ordem das fileiras, da esquerda para a direita. */
export const FLAVOR_IDS = ['ghost-face-punch', 'guarana', 'maracuja', 'uva', 'laranja', 'caju'] as const;
/** Poça de luz no chão, por sabor. */
export const FLAVOR_GLOW = [0xa7466d, 0x268656, 0xa48148, 0x7055a5, 0xaf5f44, 0xa94a42];
export const FLAVOR_ACCENT = [0xff5fae, 0x52dd74, 0xf7c653, 0xac85ff, 0xff8b3d, 0xff5d4d];

export const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));

/** Troca o rótulo; na primeira vez clona o material (as latas clonadas compartilham o original). */
export function setLabel(root: THREE.Object3D, map: THREE.Texture, clone = true) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshPhysicalMaterial;
    if (m.name === 'Fanta_Label') {
      const target = clone ? m.clone() : m;
      target.map = map;
      mesh.material = target;
    }
  });
}

export function radialTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Reflexo no chão (plano y = 0) sem segunda passada de render: a cópia da malha usa este material, que espelha
 * a posição e a normal já no espaço do mundo (vale para malha skinada, porque a pele é aplicada antes), escurece
 * e some com a profundidade `depth` (m, uniforme: acompanha a escala) e desfoca o rótulo (mip mais baixo), como
 * num chão encerado. `fade` é compartilhado: 0 esconde o reflexo junto com o objeto.
 */
export function mirrorMaterial(src: THREE.Material, fade: { value: number }, depth: { value: number }): THREE.Material {
  const m = src.clone() as THREE.MeshStandardMaterial;
  // a reflexão inverte a ordem dos vértices: a face da frente passa a ser a de trás
  m.side = THREE.BackSide;
  m.normalMap = null;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = fade;
    shader.uniforms.uDepth = depth;
    shader.vertexShader = 'varying float vReflY;\n' + shader.vertexShader
      .replace(
        '#include <normal_vertex>',
        `#include <normal_vertex>
#ifndef FLAT_SHADED
  vec3 mirrorN = normalize( mat3( modelMatrix ) * objectNormal );
  mirrorN.y = -mirrorN.y;
  vNormal = normalize( mat3( viewMatrix ) * mirrorN );
#endif`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mirrorW = modelMatrix * vec4( transformed, 1.0 );
  mirrorW.y = -mirrorW.y;
  vReflY = mirrorW.y;
  vec4 mvPosition = viewMatrix * mirrorW;
  gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = 'varying float vReflY;\nuniform float uFade;\nuniform float uDepth;\n' + shader.fragmentShader
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n  gl_FragColor.rgb *= uFade * 0.26 * pow(clamp(1.0 + vReflY / uDepth, 0.0, 1.0), 2.2);',
      )
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n  diffuseColor *= texture2D( map, vMapUv, 3.5 );\n#endif');
  };
  m.customProgramCacheKey = () => 'mirror';
  return m;
}

/** Cria, ao lado de cada malha de `root`, a cópia refletida (mesmo pai, mesma geometria, mesma pele). */
export function addMirrors(root: THREE.Object3D, fade: { value: number }, depth: { value: number }): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !mesh.userData.mirror) meshes.push(mesh);
  });
  return meshes.map((mesh) => {
    const material = mirrorMaterial(mesh.material as THREE.Material, fade, depth);
    const skinned = mesh as THREE.SkinnedMesh;
    let twin: THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      const s = new THREE.SkinnedMesh(skinned.geometry, material);
      s.bind(skinned.skeleton, skinned.bindMatrix);
      twin = s;
    } else {
      twin = new THREE.Mesh(mesh.geometry, material);
    }
    twin.userData.mirror = true;
    twin.frustumCulled = false;
    twin.position.copy(mesh.position);
    twin.quaternion.copy(mesh.quaternion);
    twin.scale.copy(mesh.scale);
    mesh.parent?.add(twin);
    return twin;
  });
}
