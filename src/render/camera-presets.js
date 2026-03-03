import * as THREE from 'three';

export const presets = {
  top: {
    position: new THREE.Vector3(0.5, 2.0, 0.5),
    target: new THREE.Vector3(0.5, 0, 0.5),
    up: new THREE.Vector3(0, 0, -1),
  },
  landscape: {
    position: new THREE.Vector3(-0.3, 1.2, 1.8),
    target: new THREE.Vector3(0.5, 0, 0.5),
    up: new THREE.Vector3(0, 1, 0),
  },
  low: {
    position: new THREE.Vector3(-0.1, 0.3, 1.5),
    target: new THREE.Vector3(0.5, 0, 0.5),
    up: new THREE.Vector3(0, 1, 0),
  },
};

// Easing: cubic ease-in-out
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Animate camera from current to preset over duration ms
export function animateToPreset(camera, controls, presetName, duration = 500) {
  const preset = presets[presetName];
  if (!preset) return Promise.resolve();

  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const startUp = camera.up.clone();
  const endPos = preset.position.clone();
  const endTarget = preset.target.clone();
  const endUp = preset.up.clone();

  const startTime = performance.now();

  return new Promise(resolve => {
    function step() {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      const e = easeInOutCubic(t);

      camera.position.lerpVectors(startPos, endPos, e);
      controls.target.lerpVectors(startTarget, endTarget, e);
      camera.up.lerpVectors(startUp, endUp, e).normalize();
      camera.lookAt(controls.target);

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}
