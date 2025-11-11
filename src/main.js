import './style.css'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js'
import { gsap } from 'gsap'
import hdriUrl from '../media/hdri_sky_860.jpg?url'
import coinModelUrl from '../3D/coin.glb?url'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

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

const fogSettings = {
  strength: 0.07,
  distance: 18,
  color: '#a880ff',
}

const coinSettings = {
  amount: 10,
  scatter: 8.4,
  rotationSpeed: 1,
  scale: 1,
}

const baseCoinDimensions = {
  radius: 1.35,
  depth: 0.24,
}

const coinFlowSettings = {
  riseSpeedMin: 0.26,
  riseSpeedMax: 0.48,
  fadeInHeight: 1.1,
  fadeOutBuffer: 1.4,
  despawnBuffer: 3.0,
}

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(new THREE.Color(fogSettings.color), 2, fogSettings.distance)

const pmremGenerator = new THREE.PMREMGenerator(renderer)
pmremGenerator.compileEquirectangularShader()

const gltfLoader = new GLTFLoader()

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
let elapsedTime = 0
const cameraShake = {
  amplitude: 0.06,
  frequency: 0.18,
  lookHeight: 0.8,
  offset: new THREE.Vector3(),
}

const baseCameraPosition = new THREE.Vector3().copy(camera.position)

const { gradientMaterial, gradientMesh } = createGradientBackground()
scene.add(gradientMesh)

const coinMaterials = new Set()
let coins = []
const coinGroup = new THREE.Group()
scene.add(coinGroup)
let uiControls = null
let coinTemplate = null
let coinTemplateScale = 1
const coinTemplateCenter = new THREE.Vector3()

gltfLoader.load(
  coinModelUrl,
  (gltf) => {
    coinTemplate = gltf.scene
    coinTemplate.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false
        child.receiveShadow = false
        child.material.side = THREE.FrontSide
      }
    })

    const bbox = new THREE.Box3().setFromObject(coinTemplate)
    bbox.getCenter(coinTemplateCenter)
    coinTemplate.position.sub(coinTemplateCenter)
    coinTemplate.updateMatrixWorld(true)

    const size = new THREE.Vector3()
    bbox.getSize(size)
    if (size.x > 0) {
      coinTemplateScale = ((baseCoinDimensions.radius * 2) / size.x) * 1
    }

    coinTemplate.rotation.set(Math.PI / 2, 0, 0)
    coinTemplate.updateMatrixWorld(true)

    rebuildCoins()
  },
  undefined,
  (error) => {
    console.error('Failed to load coin GLB', error)
  }
)

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

applyFog()
rebuildCoins()

uiControls = bindUI({
  bloomPass,
  chromaticAberrationPass,
  bokehPass,
  gradientMaterial,
  coinMaterials,
  fogSettings,
  coinSettings,
  cameraShake,
  rebuildCoins,
  applyFog,
  composer,
})

playIntroAnimation()

window.addEventListener('resize', onResize)
window.addEventListener('keydown', onKeyDown)

function animate() {
  requestAnimationFrame(animate)

  const delta = clock.getDelta()
  elapsedTime += delta

  coins.forEach((coin) => {
    coin.y += coin.riseSpeed * delta

    let alpha = 1
    if (coin.y < coin.fadeInEnd) {
      alpha = (coin.y - coin.spawnY) / (coin.fadeInEnd - coin.spawnY)
    } else if (coin.y > coin.fadeOutStart) {
      alpha = (coin.despawnY - coin.y) / (coin.despawnY - coin.fadeOutStart)
    }
    updateCoinOpacity(coin, alpha)

    if (coin.y > coin.despawnY) {
      alignCoinState(coin)
      return
    }

    const wobbleY = Math.sin(elapsedTime * 0.9 + coin.phase) * coin.sway
    const posX =
      coin.baseX + Math.sin(elapsedTime * 0.55 + coin.phase) * (0.35 + coin.sway * 0.18)
    const posZ =
      coin.baseZ + Math.sin(elapsedTime * 0.22 + coin.phase * 0.7) * (0.5 + coin.sway * 0.22)

    coin.mesh.position.set(posX, coin.y + wobbleY, posZ)
    coin.mesh.rotation.x =
      coin.baseRotationX + Math.sin(elapsedTime * 0.45 + coin.phase) * 0.3
    coin.mesh.rotation.y =
      coin.baseRotationY + Math.sin(elapsedTime * 0.32 + coin.phase * 0.6) * 0.22
    coin.mesh.rotation.z = coin.spinOffset + elapsedTime * coin.spinSpeed * 1.6
  })

  dust.rotation.y += 0.0004
  dust.position.y += 0.004
  if (dust.position.y > 1.2) {
    dust.position.y = -1.2
  }

  const shakePhase = elapsedTime * cameraShake.frequency
  cameraShake.offset.set(
    Math.sin(shakePhase * 1.3) * cameraShake.amplitude * 0.6,
    Math.sin(shakePhase * 1.7 + 0.8) * cameraShake.amplitude * 0.4,
    Math.cos(shakePhase * 1.1 + 1.4) * cameraShake.amplitude * 0.8
  )
  camera.position.copy(baseCameraPosition).add(cameraShake.offset)
  camera.lookAt(0, cameraShake.lookHeight, 0)

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

function rebuildCoins() {
  coins.forEach((coin) => {
    coinGroup.remove(coin.mesh)
    coin.mesh.traverse((child) => {
      if (child.isMesh) {
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose())
        } else if (child.material) {
          child.material.dispose()
        }
      }
    })
  })
  coins = []
  coinMaterials.clear()

  if (!coinTemplate) {
    return
  }

  for (let i = 0; i < coinSettings.amount; i += 1) {
    const instance = coinTemplate.clone(true)
    const trackedMaterials = []

    instance.traverse((child) => {
      if (child.isMesh) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map((mat) => {
            const cloned = mat.clone()
            cloned.transparent = true
            cloned.opacity = 0
            cloned.envMapIntensity = 1.85
            cloned.metalness = Math.min(1, (cloned.metalness ?? 1) * 1.05)
            cloned.roughness = Math.max(0.05, (cloned.roughness ?? 0.3) * 0.9)
            cloned.needsUpdate = true
            coinMaterials.add(cloned)
            trackedMaterials.push(cloned)
            return cloned
          })
        } else if (child.material) {
          const cloned = child.material.clone()
          cloned.transparent = true
          cloned.opacity = 0
          cloned.envMapIntensity = 1.85
          cloned.metalness = Math.min(1, (cloned.metalness ?? 1) * 1.05)
          cloned.roughness = Math.max(0.05, (cloned.roughness ?? 0.3) * 0.9)
          cloned.needsUpdate = true
          coinMaterials.add(cloned)
          trackedMaterials.push(cloned)
          child.material = cloned
        }
      }
    })

    const coinData = {
      mesh: instance,
      materials: trackedMaterials,
      baseX: 0,
      baseZ: 0,
      phase: Math.random() * Math.PI * 2,
      sway: 0.25 + Math.random() * 0.2,
      baseRotationX: 0,
      baseRotationY: 0,
      spinOffset: Math.random() * Math.PI * 2,
      spinSpeed: (0.14 + Math.random() * 0.1) * coinSettings.rotationSpeed,
      riseSpeed: 0.3,
      spawnY: 0,
      fadeInEnd: 0,
      fadeOutStart: 0,
      despawnY: 0,
      y: 0,
      opacity: 0,
    }

    instance.scale.setScalar(coinTemplateScale * coinSettings.scale)
    coinGroup.add(instance)
    coins.push(coinData)
    alignCoinState(coinData, true)
  }

  if (uiControls && typeof uiControls.updateEnvironment === 'function') {
    uiControls.updateEnvironment()
  }
}

function alignCoinState(coin, initial = false) {
  const scatter = coinSettings.scatter
  const spawnDepth = -scatter * 1.7 - 1.5 - Math.random() * 1.8
  const visibleTop = scatter * 1.25 + 1.6

  coin.baseX = (Math.random() - 0.5) * scatter * 2.4
  coin.baseZ = (Math.random() - 0.5) * scatter * 2.2
  coin.baseRotationX = (Math.random() - 0.5) * 0.35
  coin.baseRotationY = (Math.random() - 0.5) * 0.65
  coin.spinOffset = Math.random() * Math.PI * 2
  coin.spinSpeed = (0.14 + Math.random() * 0.1) * coinSettings.rotationSpeed
  coin.riseSpeed = THREE.MathUtils.lerp(
    coinFlowSettings.riseSpeedMin,
    coinFlowSettings.riseSpeedMax,
    Math.random()
  )

  coin.spawnY = spawnDepth
  coin.fadeInEnd = spawnDepth + coinFlowSettings.fadeInHeight
  coin.fadeOutStart = visibleTop - coinFlowSettings.fadeOutBuffer
  coin.despawnY = visibleTop + coinFlowSettings.despawnBuffer
  coin.y = initial
    ? THREE.MathUtils.lerp(coin.spawnY, coin.fadeOutStart, Math.random())
    : coin.spawnY
  coin.opacity = 0

  coin.mesh.position.set(coin.baseX, coin.y, coin.baseZ)
  coin.mesh.rotation.set(coin.baseRotationX, coin.baseRotationY, coin.spinOffset)
  updateCoinOpacity(coin, 0)
}

function updateCoinOpacity(coin, alpha) {
  const clamped = THREE.MathUtils.clamp(alpha, 0, 1)
  if (Math.abs(clamped - coin.opacity) < 0.001) {
    return
  }
  coin.opacity = clamped
  coin.materials.forEach((material) => {
    material.opacity = clamped
    material.needsUpdate = true
  })
}

function applyFog() {
  const color = new THREE.Color(fogSettings.color)
  const distance = Math.max(fogSettings.distance, 6)
  const near = Math.max(0.1, distance * (1 - fogSettings.strength * 0.85))
  const far = Math.max(distance, near + 5)

  scene.fog.color.copy(color)
  scene.fog.near = near
  scene.fog.far = far
}

function bindUI({
  bloomPass,
  chromaticAberrationPass,
  bokehPass,
  gradientMaterial,
  coinMaterials,
  fogSettings,
  coinSettings,
  cameraShake,
  rebuildCoins,
  applyFog,
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
    fogStrength: document.getElementById('fog-strength'),
    fogDistance: document.getElementById('fog-distance'),
    fogColor: document.getElementById('fog-color'),
    coinAmount: document.getElementById('coin-amount'),
    coinScatter: document.getElementById('coin-scatter'),
    coinRotation: document.getElementById('coin-rotation'),
    coinScale: document.getElementById('coin-scale'),
    cameraShakeAmp: document.getElementById('camera-shake-amp'),
    cameraShakeFreq: document.getElementById('camera-shake-freq'),
    cameraLookHeight: document.getElementById('camera-look-height'),
    copyButton: document.getElementById('copy-settings'),
  }

  elements.fogStrength.value = fogSettings.strength
  elements.fogDistance.value = fogSettings.distance
  elements.fogColor.value = fogSettings.color

  elements.coinAmount.value = coinSettings.amount
  elements.coinScatter.value = coinSettings.scatter
  elements.coinRotation.value = coinSettings.rotationSpeed
  elements.coinScale.value = coinSettings.scale
  if (elements.cameraShakeAmp) {
    elements.cameraShakeAmp.value = cameraShake.amplitude
  }
  if (elements.cameraShakeFreq) {
    elements.cameraShakeFreq.value = cameraShake.frequency
  }
  if (elements.cameraLookHeight) {
    elements.cameraLookHeight.value = cameraShake.lookHeight
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

  function updateFog() {
    fogSettings.strength = parseFloat(elements.fogStrength.value)
    fogSettings.distance = parseFloat(elements.fogDistance.value)
    fogSettings.color = elements.fogColor.value
    applyFog()
  }

  function updateCoins() {
    coinSettings.amount = Math.max(3, Math.min(40, Math.round(elements.coinAmount.value)))
    elements.coinAmount.value = coinSettings.amount
    coinSettings.scatter = parseFloat(elements.coinScatter.value)
    coinSettings.rotationSpeed = parseFloat(elements.coinRotation.value)
    coinSettings.scale = parseFloat(elements.coinScale.value)
    rebuildCoins()
  }

  function updateEnvironment() {
    const intensity = parseFloat(elements.envIntensity.value)
    coinMaterials.forEach((material) => {
      material.envMapIntensity = intensity
      material.needsUpdate = true
    })
  }

  function updateCamera() {
    if (elements.cameraShakeAmp) {
      cameraShake.amplitude = parseFloat(elements.cameraShakeAmp.value)
    }
    if (elements.cameraShakeFreq) {
      cameraShake.frequency = parseFloat(elements.cameraShakeFreq.value)
    }
    if (elements.cameraLookHeight) {
      cameraShake.lookHeight = parseFloat(elements.cameraLookHeight.value)
    }
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
      fog: {
        strength: parseFloat(elements.fogStrength.value),
        distance: parseFloat(elements.fogDistance.value),
        color: elements.fogColor.value,
      },
      coins: {
        amount: coinSettings.amount,
        scatter: coinSettings.scatter,
        rotationSpeed: coinSettings.rotationSpeed,
        scale: coinSettings.scale,
      },
      camera:
        elements.cameraShakeAmp && elements.cameraShakeFreq && elements.cameraLookHeight
          ? {
              amplitude: parseFloat(elements.cameraShakeAmp.value),
              frequency: parseFloat(elements.cameraShakeFreq.value),
              lookHeight: parseFloat(elements.cameraLookHeight.value),
            }
          : undefined,
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
  elements.fogStrength.addEventListener('input', updateFog)
  elements.fogDistance.addEventListener('input', updateFog)
  elements.fogColor.addEventListener('input', updateFog)
  elements.coinAmount.addEventListener('change', updateCoins)
  elements.coinAmount.addEventListener('input', (event) => {
    event.target.setAttribute('value', event.target.value)
  })
  elements.coinScatter.addEventListener('input', updateCoins)
  elements.coinRotation.addEventListener('input', updateCoins)
  elements.coinScale.addEventListener('input', updateCoins)
  elements.cameraShakeAmp?.addEventListener('input', updateCamera)
  elements.cameraShakeFreq?.addEventListener('input', updateCamera)
  elements.cameraLookHeight?.addEventListener('input', updateCamera)

  elements.copyButton.addEventListener('click', copySettings)

  updateBloom()
  updateChromaticAberration()
  updateDOF()
  updateGradient()
  updateEnvironment()
  updateFog()
  updateCamera()

  return {
    updateBloom,
    updateChromaticAberration,
    updateDOF,
    updateGradient,
    updateEnvironment,
    updateFog,
    updateCoins,
  }
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
