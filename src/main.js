import './style.css'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js'
import { gsap } from 'gsap'
import hdriUrl from '../media/hdri_sky_782.jpg?url'

const canvas = document.getElementById('scene')
const uiPanel = document.getElementById('ui-panel')

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: new THREE.Vector2(0.003, -0.003) },
    direction: { value: new THREE.Vector2(1.0, 0.5) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 offset;
    uniform vec2 direction;
    varying vec2 vUv;

    void main() {
      vec2 dir = normalize(direction);
      vec4 baseColor = texture2D(tDiffuse, vUv);
      float shiftR = texture2D(tDiffuse, vUv + dir * offset.x).r;
      float shiftB = texture2D(tDiffuse, vUv - dir * offset.y).b;
      gl_FragColor = vec4(shiftR, baseColor.g, shiftB, baseColor.a);
    }
  `,
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
})
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x050a12, 0.045)

const pmremGenerator = new THREE.PMREMGenerator(renderer)
pmremGenerator.compileEquirectangularShader()

new THREE.TextureLoader().load(
  hdriUrl,
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.SRGBColorSpace
    const envTexture = pmremGenerator.fromEquirectangular(texture).texture
    scene.environment = envTexture
    texture.dispose()
    pmremGenerator.dispose()
  },
  undefined,
  () => {
    pmremGenerator.dispose()
  }
)

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100)
camera.position.set(0, 1.8, 11.5)
scene.add(camera)

const clock = new THREE.Clock()

const { gradientMaterial, gradientMesh } = createGradientBackground()
scene.add(gradientMesh)

const { coins, materials: coinMaterials } = createCoins()
coins.forEach((coin) => scene.add(coin.mesh))

const dust = createDustParticles()
scene.add(dust)

createLighting()

const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  depthBuffer: true,
  stencilBuffer: false,
  samples: renderer.capabilities.isWebGL2 ? 4 : 0,
})

const composer = new EffectComposer(renderer, renderTarget)
composer.setSize(window.innerWidth, window.innerHeight)
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
const renderPass = new RenderPass(scene, camera)
composer.addPass(renderPass)

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.58,
  1.33,
  0.44
)
composer.addPass(bloomPass)

const chromaticAberrationPass = new ShaderPass(ChromaticAberrationShader)
chromaticAberrationPass.uniforms.direction.value.set(1.0, 0.5)
chromaticAberrationPass.uniforms.offset.value.set(0.0013, -0.0013)
composer.addPass(chromaticAberrationPass)

class SmoothBokehPass extends BokehPass {
  constructor(scene, camera, params, excluded = []) {
    super(scene, camera, params)
    this.ignore = excluded
    this._visibility = new Map()
  }

  render(renderer, writeBuffer, readBuffer) {
    this.ignore.forEach((object3d) => {
      if (!object3d) return
      this._visibility.set(object3d, object3d.visible)
      object3d.visible = false
    })

    super.render(renderer, writeBuffer, readBuffer)

    this.ignore.forEach((object3d) => {
      if (!object3d) return
      const prev = this._visibility.get(object3d)
      object3d.visible = prev === undefined ? true : prev
    })
  }
}

const bokehPass = new SmoothBokehPass(scene, camera, {
  focus: 8.0,
  aperture: 0.00035,
  maxblur: 0.008,
}, [dust])
composer.addPass(bokehPass)

bindUI({
  bloomPass,
  chromaticAberrationPass,
  bokehPass,
  gradientMaterial,
  coinMaterials,
  composer,
})

playIntroAnimation()

window.addEventListener('resize', onResize)
window.addEventListener('keydown', onKeyDown)

function animate() {
  requestAnimationFrame(animate)

  const elapsed = clock.getElapsedTime()

  coins.forEach((coin) => {
    coin.mesh.rotation.x =
      coin.baseRotationX + Math.sin(elapsed * 0.35 + coin.phase) * 0.08
    coin.mesh.rotation.y =
      coin.baseRotationY + Math.sin(elapsed * 0.2 + coin.phase * 0.5) * 0.05
    coin.mesh.rotation.z = coin.spinOffset + elapsed * coin.spinSpeed
    coin.mesh.position.y =
      coin.baseY + Math.sin(elapsed * 0.85 + coin.phase) * coin.sway + elapsed * 0.02
    coin.mesh.position.x =
      coin.baseX + Math.sin(elapsed * 0.55 + coin.phase) * (0.35 + coin.sway * 0.15)
    coin.mesh.position.z =
      coin.baseZ + Math.sin(elapsed * 0.18 + coin.phase * 0.7) * (0.45 + coin.sway * 0.2)
  })

  dust.rotation.y += 0.0004
  dust.position.y += 0.004
  if (dust.position.y > 1.2) {
    dust.position.y = -1.2
  }

  gradientMaterial.uniforms.uAspect.value = window.innerWidth / window.innerHeight

  composer.render()
}

animate()

function createGradientBackground() {
  const geometry = new THREE.PlaneGeometry(40, 40)
  const shaderMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColorInner: { value: new THREE.Color('#ad5cff') },
      uColorOuter: { value: new THREE.Color('#150080') },
      uAspect: { value: window.innerWidth / window.innerHeight },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 uColorInner;
      uniform vec3 uColorOuter;
      uniform float uAspect;
      void main() {
        vec2 centered = vUv - 0.5;
        centered.x *= uAspect * 1.15;
        float dist = length(centered) * 1.75;
        float falloff = smoothstep(0.0, 1.0, dist);
        vec3 color = mix(uColorInner, uColorOuter, falloff);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    depthWrite: false,
    depthTest: false,
  })

  const mesh = new THREE.Mesh(geometry, shaderMaterial)
  mesh.position.z = -15
  mesh.renderOrder = -1

  return { gradientMaterial: shaderMaterial, gradientMesh: mesh }
}

function createCoins() {
  const coins = []
  const materialSet = new Set()

  const positions = [
    { x: -7.8, y: 3.6, z: -2.4 },
    { x: 5.6, y: 4.1, z: -3.6 },
    { x: -1.2, y: 0.8, z: 5.1 },
    { x: 3.2, y: -2.3, z: 4.2 },
    { x: -4.8, y: -1.6, z: 2.9 },
    { x: 7.4, y: 0.2, z: 0.8 },
    { x: -8.2, y: 0.9, z: -4.8 },
    { x: 2.1, y: 5.6, z: -5.4 },
    { x: -2.8, y: -3.8, z: -3.2 },
    { x: 6.2, y: 2.9, z: 3.6 },
  ]

  positions.forEach((pos) => {
    const radius = 1.05 + Math.random() * 0.6
    const depth = 0.19 + Math.random() * 0.07
    const segments = 96

    const geometry = new THREE.CylinderGeometry(radius, radius, depth, segments, 1, false)

    const faceColor = new THREE.Color('#fff6c5')
    faceColor.offsetHSL(0, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.08)

    const faceMaterial = new THREE.MeshPhysicalMaterial({
      color: faceColor,
      metalness: 1,
      roughness: 0.1 + Math.random() * 0.04,
      clearcoat: 0.82,
      clearcoatRoughness: 0.03,
      emissive: faceColor.clone().multiplyScalar(0.16),
      sheen: 0.35,
      sheenColor: faceColor.clone().multiplyScalar(0.7),
      envMapIntensity: 1.85,
    })

    const rimMaterial = faceMaterial.clone()
    rimMaterial.roughness = faceMaterial.roughness + 0.035
    rimMaterial.color = faceMaterial.color.clone().offsetHSL(0, -0.015, -0.06)
    rimMaterial.envMapIntensity = faceMaterial.envMapIntensity * 1.05

    materialSet.add(faceMaterial)
    materialSet.add(rimMaterial)

    const mesh = new THREE.Mesh(geometry, [faceMaterial, faceMaterial, rimMaterial])
    mesh.position.set(pos.x, pos.y, pos.z)

    const baseRotationX = Math.PI / 2 - 0.12 + (Math.random() - 0.5) * 0.16
    const baseRotationY = (Math.random() - 0.5) * 0.18
    const spinOffset = Math.random() * Math.PI * 2
    const spinSpeed = 0.06 + Math.random() * 0.025

    mesh.rotation.set(baseRotationX, baseRotationY, spinOffset)

    coins.push({
      mesh,
      baseX: mesh.position.x,
      baseY: mesh.position.y,
      baseZ: mesh.position.z,
      phase: Math.random() * Math.PI * 2,
      sway: 0.3 + Math.random() * 0.18,
      baseRotationX,
      baseRotationY,
      spinOffset,
      spinSpeed,
    })
  })

  return { coins, materials: Array.from(materialSet) }
}

function createDustParticles() {
  const particles = 800
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(particles * 3)
  const sizes = new Float32Array(particles)

  for (let i = 0; i < particles; i++) {
    const radius = 12 * Math.random()
    const angle = Math.random() * Math.PI * 2
    const height = (Math.random() - 0.5) * 8
    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = height
    positions[i * 3 + 2] = Math.sin(angle) * radius
    sizes[i] = Math.random() * 0.5 + 0.2
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

  const material = new THREE.PointsMaterial({
    color: new THREE.Color(0xa9c6ff),
    size: 0.04,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, material)
  points.position.z = -2
  return points
}

function createLighting() {
  const hemiLight = new THREE.HemisphereLight(0x9abfff, 0x0a0f1a, 0.7)
  scene.add(hemiLight)

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2)
  keyLight.position.set(5, 8, 5)
  keyLight.castShadow = false
  scene.add(keyLight)

  const rimLight = new THREE.SpotLight(0xffcc88, 2.6, 40, Math.PI / 5, 0.35, 1.8)
  rimLight.position.set(-6, 6, -2)
  scene.add(rimLight)

  const fillLight = new THREE.PointLight(0x66aaff, 1.4, 18)
  fillLight.position.set(0, -1.5, 3.5)
  scene.add(fillLight)
}

function bindUI({
  bloomPass,
  chromaticAberrationPass,
  bokehPass,
  gradientMaterial,
  coinMaterials,
  composer,
}) {
  const elements = {
    bloomEnabled: document.getElementById('bloom-enabled'),
    bloomStrength: document.getElementById('bloom-strength'),
    bloomRadius: document.getElementById('bloom-radius'),
    bloomThreshold: document.getElementById('bloom-threshold'),
    caEnabled: document.getElementById('ca-enabled'),
    caOffset: document.getElementById('ca-offset'),
    dofEnabled: document.getElementById('dof-enabled'),
    dofFocus: document.getElementById('dof-focus'),
    dofAperture: document.getElementById('dof-aperture'),
    dofMaxblur: document.getElementById('dof-maxblur'),
    gradientInner: document.getElementById('gradient-inner'),
    gradientOuter: document.getElementById('gradient-outer'),
    envIntensity: document.getElementById('env-intensity'),
    copyButton: document.getElementById('copy-settings'),
  }

  function updateBloom() {
    bloomPass.enabled = elements.bloomEnabled.checked
    bloomPass.strength = parseFloat(elements.bloomStrength.value)
    bloomPass.radius = parseFloat(elements.bloomRadius.value)
    bloomPass.threshold = parseFloat(elements.bloomThreshold.value)
  }

  function updateChromaticAberration() {
    const offsetValue = parseFloat(elements.caOffset.value)
    chromaticAberrationPass.enabled = elements.caEnabled.checked
    chromaticAberrationPass.uniforms.offset.value.set(offsetValue, -offsetValue)
  }

  function updateDOF() {
    bokehPass.enabled = elements.dofEnabled.checked
    bokehPass.materialBokeh.uniforms.focus.value = parseFloat(elements.dofFocus.value)
    bokehPass.materialBokeh.uniforms.aperture.value = parseFloat(elements.dofAperture.value)
    bokehPass.materialBokeh.uniforms.maxblur.value = parseFloat(elements.dofMaxblur.value)
  }

  function updateGradient() {
    gradientMaterial.uniforms.uColorInner.value.set(elements.gradientInner.value)
    gradientMaterial.uniforms.uColorOuter.value.set(elements.gradientOuter.value)
  }

  function updateEnvironment() {
    const intensity = parseFloat(elements.envIntensity.value)
    coinMaterials.forEach((material) => {
      material.envMapIntensity = intensity
      material.needsUpdate = true
    })
  }

  function copySettings() {
    const config = {
      bloom: {
        enabled: elements.bloomEnabled.checked,
        strength: parseFloat(elements.bloomStrength.value),
        radius: parseFloat(elements.bloomRadius.value),
        threshold: parseFloat(elements.bloomThreshold.value),
      },
      chromaticAberration: {
        enabled: elements.caEnabled.checked,
        offset: parseFloat(elements.caOffset.value),
      },
      depthOfField: {
        enabled: elements.dofEnabled.checked,
        focus: parseFloat(elements.dofFocus.value),
        aperture: parseFloat(elements.dofAperture.value),
        maxblur: parseFloat(elements.dofMaxblur.value),
      },
      gradient: {
        inner: elements.gradientInner.value,
        outer: elements.gradientOuter.value,
      },
      environment: {
        reflection: parseFloat(elements.envIntensity.value),
      },
    }

    navigator.clipboard?.writeText(JSON.stringify(config, null, 2)).then(
      () => {
        const label = elements.copyButton.textContent
        elements.copyButton.textContent = 'Copied!'
        setTimeout(() => {
          elements.copyButton.textContent = label
        }, 1500)
      },
      () => {
        window.alert(JSON.stringify(config, null, 2))
      }
    )
  }

  elements.bloomEnabled.addEventListener('change', updateBloom)
  elements.bloomStrength.addEventListener('input', updateBloom)
  elements.bloomRadius.addEventListener('input', updateBloom)
  elements.bloomThreshold.addEventListener('input', updateBloom)

  elements.caEnabled.addEventListener('change', updateChromaticAberration)
  elements.caOffset.addEventListener('input', updateChromaticAberration)

  elements.dofEnabled.addEventListener('change', updateDOF)
  elements.dofFocus.addEventListener('input', updateDOF)
  elements.dofAperture.addEventListener('input', updateDOF)
  elements.dofMaxblur.addEventListener('input', updateDOF)

  elements.gradientInner.addEventListener('input', updateGradient)
  elements.gradientOuter.addEventListener('input', updateGradient)
  elements.envIntensity.addEventListener('input', updateEnvironment)

  elements.copyButton.addEventListener('click', copySettings)

  updateBloom()
  updateChromaticAberration()
  updateDOF()
  updateGradient()
  updateEnvironment()

  return { updateBloom, updateChromaticAberration, updateDOF, updateGradient, updateEnvironment }
}

function playIntroAnimation() {
  const tl = gsap.timeline({ delay: 0.4, defaults: { ease: 'power3.out', duration: 1.2 } })
  tl.to('.hero-title', { opacity: 1, y: 0, duration: 1.4 }, 0).to(
    '.hero-cta',
    { opacity: 1, y: 0, duration: 1.1 },
    0.15
  )
}

function onResize() {
  const width = window.innerWidth
  const height = window.innerHeight

  camera.aspect = width / height
  camera.updateProjectionMatrix()

  renderer.setSize(width, height)
  composer.setSize(width, height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  bloomPass.setSize(width, height)
}

function onKeyDown(event) {
  if (event.key.toLowerCase() === 'p') {
    uiPanel.classList.toggle('hidden')
  }
}
