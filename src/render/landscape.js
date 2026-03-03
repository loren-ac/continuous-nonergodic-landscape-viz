import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { mapColors } from './colormaps.js';
import { presets, animateToPreset } from './camera-presets.js';
import * as tooltip from './tooltip.js';

export class LandscapeRenderer {
  constructor(container) {
    this.container = container;
    this.gridData = null;
    this.colorName = 'viridis';
    this.heightEnabled = false;
    this.heightScale = 1.0;
    this.pointSize = 2.0;
    this.dirty = true;
    this.hoveredIndex = -1;
    this.onHover = null; // callback(index, x, a, value) or null
    this.onClick = null; // callback(index, x, a, value) or null
    this._refMarker = null;
    this._selectedMarker = null;
    this._upperSurface = null;
    this._lowerSurface = null;
    this._varianceEnabled = false;
    this.isMuted = false;

    this._initRenderer();
    this._initScene();
    this._initControls();
    this._initRaycaster();
    this._initAxisLabels();
    this._bindEvents();
    this._animate = this._animate.bind(this);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x1a1a1a, 1);
    this.container.appendChild(this.renderer.domElement);
    this._resize();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, this._aspect(), 0.01, 100);

    // Start at top-down view
    const p = presets.top;
    this.camera.position.copy(p.position);
    this.camera.up.copy(p.up);

    // Grid lines for reference
    this._addGridHelper();
  }

  _addGridHelper() {
    // Subtle grid on the ground plane
    const gridSize = 1;
    const divisions = 10;
    const gridHelper = new THREE.GridHelper(gridSize, divisions, 0x3a3a3a, 0x2e2e2e);
    gridHelper.position.set(0.5, -0.001, 0.5);
    this.scene.add(gridHelper);
    this.gridHelper = gridHelper;
  }

  _initControls() {
    this.controls = new TrackballControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0.5, 0, 0.5);
    this.controls.rotateSpeed = 2.0;
    this.controls.zoomSpeed = 1.2;
    this.controls.panSpeed = 0.8;
    this.controls.staticMoving = false;
    this.controls.dynamicDampingFactor = 0.12;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 5;
    this.controls.update();
    this.controls.addEventListener('change', () => { this.dirty = true; });
  }

  _initAxisLabels() {
    this.labelX = document.getElementById('label-x');
    this.labelA = document.getElementById('label-a');
    // 3D positions for label anchors (just past axis endpoints)
    this._labelXPos = new THREE.Vector3(0.5, 0, -0.06);
    this._labelAPos = new THREE.Vector3(-0.06, 0, 0.5);
    this._projVec = new THREE.Vector3();
  }

  _updateAxisLabels() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // Project X label
    this._projVec.copy(this._labelXPos).project(this.camera);
    const xScreen = (this._projVec.x * 0.5 + 0.5) * w;
    const yScreen = (-this._projVec.y * 0.5 + 0.5) * h;
    const behind = this._projVec.z > 1;
    this.labelX.style.left = xScreen + 'px';
    this.labelX.style.top = yScreen + 'px';
    this.labelX.style.opacity = behind ? '0' : '0.6';

    // Project A label
    this._projVec.copy(this._labelAPos).project(this.camera);
    const aXScreen = (this._projVec.x * 0.5 + 0.5) * w;
    const aYScreen = (-this._projVec.y * 0.5 + 0.5) * h;
    const aBehind = this._projVec.z > 1;
    this.labelA.style.left = aXScreen + 'px';
    this.labelA.style.top = aYScreen + 'px';
    this.labelA.style.opacity = aBehind ? '0' : '0.6';
  }

  _initRaycaster() {
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points.threshold = 0.015;
    this.mouse = new THREE.Vector2();
    this.mouseScreen = { x: 0, y: 0 };
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._resize());
    this.renderer.domElement.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.renderer.domElement.addEventListener('mouseleave', () => this._onMouseLeave());
    this.renderer.domElement.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.renderer.domElement.addEventListener('mouseup', (e) => this._onMouseUp(e));
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.controls) {
      this.controls.handleResize();
    }
    this.dirty = true;
  }

  _aspect() {
    return this.container.clientWidth / this.container.clientHeight;
  }

  _onMouseMove(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.mouseScreen.x = e.clientX;
    this.mouseScreen.y = e.clientY;
    this.dirty = true;
  }

  _onMouseLeave() {
    this.hoveredIndex = -1;
    tooltip.hide();
    this.dirty = true;
  }

  // Set grid data and rebuild geometry
  setData(gridData, colorName) {
    this.gridData = gridData;
    this.colorName = colorName || this.colorName;
    this.isMuted = false;

    // Remove old points and variance surfaces
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points.material.dispose();
    }
    this.clearVarianceSurfaces();

    const { params, values, N, vMin, vMax } = gridData;
    const [p0, p1] = [gridData.process.params[0], gridData.process.params[1]];

    // Build positions: X = normalized x, Z = normalized a, Y = height
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);

    for (let i = 0; i < N; i++) {
      const x = params[i * 2];
      const a = params[i * 2 + 1];
      // Normalize to [0, 1]
      const nx = (x - p0.min) / (p0.max - p0.min);
      const na = (a - p1.min) / (p1.max - p1.min);
      positions[i * 3] = nx;
      positions[i * 3 + 1] = this.heightEnabled
        ? ((values[i] - vMin) / (vMax - vMin || 1)) * this.heightScale * 0.5
        : 0;
      positions[i * 3 + 2] = na;
    }

    mapColors(this.colorName, values, vMin, vMax, colors);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: this.pointSize * 0.01,
      vertexColors: true,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geometry, material);
    this.scene.add(this.points);
    this.dirty = true;
  }

  // Update colors without rebuilding geometry
  updateColors(colorName) {
    if (!this.gridData || !this.points) return;
    this.colorName = colorName;
    const { values, vMin, vMax } = this.gridData;
    const colors = this.points.geometry.attributes.color.array;
    mapColors(colorName, values, vMin, vMax, colors);
    this.points.geometry.attributes.color.needsUpdate = true;
    this.dirty = true;
  }

  // Update height mapping
  updateHeight(enabled, scale) {
    if (!this.gridData || !this.points) return;
    this.heightEnabled = enabled;
    this.heightScale = scale;

    const { values, vMin, vMax, N } = this.gridData;
    const positions = this.points.geometry.attributes.position.array;
    const range = vMax - vMin || 1;

    for (let i = 0; i < N; i++) {
      positions[i * 3 + 1] = enabled
        ? ((values[i] - vMin) / range) * scale * 0.5
        : 0;
    }
    this.points.geometry.attributes.position.needsUpdate = true;

    // Move grid helper down slightly
    this.gridHelper.position.y = -0.001;

    // Update variance surfaces if present
    if (this._upperSurface && this.gridData && this.gridData.variances) {
      const { values, variances, vMin, vMax } = this.gridData;
      const gRange = vMax - vMin || 1;
      for (const [mesh, sign] of [[this._upperSurface, 1], [this._lowerSurface, -1]]) {
        if (!mesh) continue;
        const pos = mesh.geometry.attributes.position.array;
        for (let i = 0; i < N; i++) {
          const std = Math.sqrt(variances[i]);
          pos[i * 3 + 1] = enabled
            ? ((values[i] + sign * std - vMin) / gRange) * scale * 0.5
            : 0;
        }
        mesh.geometry.attributes.position.needsUpdate = true;
      }
      // Hide variance surfaces when height is off
      if (this._upperSurface) this._upperSurface.visible = this._varianceEnabled && enabled;
      if (this._lowerSurface) this._lowerSurface.visible = this._varianceEnabled && enabled;
    }

    this.dirty = true;
  }

  updatePointSize(size) {
    this.pointSize = size;
    if (this.points) {
      this.points.material.size = size * 0.01;
      this.dirty = true;
    }
  }

  updateClearColor(hex) {
    this.renderer.setClearColor(hex, 1);
    this.dirty = true;
  }

  // Camera presets
  async goToPreset(name) {
    await animateToPreset(this.camera, this.controls, name);
    this.dirty = true;
  }

  // Click detection (distinguish from drag)
  _onMouseDown(e) {
    this._clickStart = { x: e.clientX, y: e.clientY, time: performance.now() };
  }

  _onMouseUp(e) {
    if (!this._clickStart) return;
    const dx = e.clientX - this._clickStart.x;
    const dy = e.clientY - this._clickStart.y;
    const dt = performance.now() - this._clickStart.time;
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5 && dt < 300) {
      this._performClick(e);
    }
    this._clickStart = null;
  }

  _performClick(e) {
    if (!this.points || !this.onClick) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.points);
    if (intersects.length > 0) {
      const idx = intersects[0].index;
      const { params, values } = this.gridData;
      this.onClick(idx, params[idx * 2], params[idx * 2 + 1], values[idx]);
    }
  }

  // Reference point marker
  setReferenceMarker(nx, na) {
    this.clearReferenceMarker();
    const geometry = new THREE.RingGeometry(0.008, 0.012, 24);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xe8a84c,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this._refMarker = new THREE.Mesh(geometry, material);
    this._refMarker.position.set(nx, 0.002, na);
    this._refMarker.renderOrder = 999;
    this.scene.add(this._refMarker);
    this.dirty = true;
  }

  clearReferenceMarker() {
    if (this._refMarker) {
      this.scene.remove(this._refMarker);
      this._refMarker.geometry.dispose();
      this._refMarker.material.dispose();
      this._refMarker = null;
      this.dirty = true;
    }
  }

  // Selected point marker (for detail panel — filled circle, distinct from ref ring)
  setSelectedMarker(nx, na) {
    this.clearSelectedMarker();
    const geometry = new THREE.CircleGeometry(0.008, 24);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xe8a84c,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this._selectedMarker = new THREE.Mesh(geometry, material);
    this._selectedMarker.position.set(nx, 0.003, na);
    this._selectedMarker.renderOrder = 998;
    this.scene.add(this._selectedMarker);
    this.dirty = true;
  }

  clearSelectedMarker() {
    if (this._selectedMarker) {
      this.scene.remove(this._selectedMarker);
      this._selectedMarker.geometry.dispose();
      this._selectedMarker.material.dispose();
      this._selectedMarker = null;
      this.dirty = true;
    }
  }

  // Variance surfaces: translucent mesh at mean ± stddev
  setVarianceSurfaces(gridData) {
    this.clearVarianceSurfaces();
    if (!gridData.variances || !gridData.nx || !gridData.ny) return;

    const { values, variances, vMin, vMax, nx, ny, N } = gridData;
    const [p0, p1] = [gridData.process.params[0], gridData.process.params[1]];
    const range = vMax - vMin || 1;

    for (const sign of [1, -1]) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(N * 3);

      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const idx = iy * nx + ix;
          const x = gridData.params[idx * 2];
          const a = gridData.params[idx * 2 + 1];
          const nx_ = (x - p0.min) / (p0.max - p0.min);
          const na_ = (a - p1.min) / (p1.max - p1.min);
          const std = Math.sqrt(variances[idx]);
          const y = this.heightEnabled
            ? ((values[idx] + sign * std - vMin) / range) * this.heightScale * 0.5
            : sign * std * 0.02; // tiny offset when flat

          positions[idx * 3] = nx_;
          positions[idx * 3 + 1] = y;
          positions[idx * 3 + 2] = na_;
        }
      }

      // Build index buffer for triangle mesh
      const indices = [];
      for (let iy = 0; iy < ny - 1; iy++) {
        for (let ix = 0; ix < nx - 1; ix++) {
          const i0 = iy * nx + ix;
          const i1 = i0 + 1;
          const i2 = i0 + nx;
          const i3 = i2 + 1;
          indices.push(i0, i2, i1);
          indices.push(i1, i2, i3);
        }
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const material = new THREE.MeshBasicMaterial({
        color: 0xe8a84c,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 500;
      mesh.visible = this._varianceEnabled && this.heightEnabled;
      this.scene.add(mesh);

      if (sign === 1) this._upperSurface = mesh;
      else this._lowerSurface = mesh;
    }

    this.dirty = true;
  }

  clearVarianceSurfaces() {
    for (const mesh of [this._upperSurface, this._lowerSurface]) {
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
    this._upperSurface = null;
    this._lowerSurface = null;
    this.dirty = true;
  }

  toggleVariance(enabled) {
    this._varianceEnabled = enabled;
    const show = enabled && this.heightEnabled;
    if (this._upperSurface) this._upperSurface.visible = show;
    if (this._lowerSurface) this._lowerSurface.visible = show;
    this.dirty = true;
  }

  // Public resize (called after panel open/close transition)
  resize() {
    this._resize();
  }

  // Mute point cloud to uniform gray (awaiting reference state)
  muteColors() {
    this.isMuted = true;
    if (!this.points) return;
    const colors = this.points.geometry.attributes.color.array;
    const positions = this.points.geometry.attributes.position.array;
    const N = colors.length / 3;
    for (let i = 0; i < N; i++) {
      colors[i * 3] = 0.23;
      colors[i * 3 + 1] = 0.23;
      colors[i * 3 + 2] = 0.23;
      positions[i * 3 + 1] = 0; // flatten Y
    }
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.dirty = true;
  }

  // Raycasting for hover
  _updateHover() {
    if (!this.points) return;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.points);

    if (intersects.length > 0) {
      const idx = intersects[0].index;
      const { params, values } = this.gridData;
      const x = params[idx * 2];
      const a = params[idx * 2 + 1];
      const v = this.isMuted ? null : values[idx];
      if (idx !== this.hoveredIndex) {
        this.hoveredIndex = idx;
        tooltip.show(this.mouseScreen.x, this.mouseScreen.y, x, a, v);
        if (this.onHover) this.onHover(idx, x, a, v);
      } else {
        tooltip.show(this.mouseScreen.x, this.mouseScreen.y, x, a, v);
      }
    } else {
      if (this.hoveredIndex !== -1) {
        this.hoveredIndex = -1;
        tooltip.hide();
        if (this.onHover) this.onHover(-1, 0, 0, 0);
      }
    }
  }

  // Animation loop
  start() {
    this._running = true;
    this._animate();
  }

  stop() {
    this._running = false;
  }

  _animate() {
    if (!this._running) return;
    requestAnimationFrame(this._animate);

    this.controls.update();
    this._updateHover();

    this._updateAxisLabels();

    // Always render — TrackballControls damping needs continuous updates
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }

  dispose() {
    this.stop();
    if (this.points) {
      this.points.geometry.dispose();
      this.points.material.dispose();
    }
    this.clearVarianceSurfaces();
    this.renderer.dispose();
    this.controls.dispose();
  }
}
