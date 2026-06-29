import React, { useEffect, useImperativeHandle, useRef } from "react";
import * as OBC from "@thatopen/components";
import * as THREE from "three";

const PICKED_COLOR = new THREE.Color(0xf59e0b);

export const ThatOpenCanvas = React.forwardRef(function ThatOpenCanvas({ asset, modelFile, onStateChange }, ref) {
  const containerRef = useRef(null);
  const componentsRef = useRef(null);
  const fragmentsRef = useRef(null);
  const fragmentsReadyRef = useRef(null);
  const modelRef = useRef(null);
  const worldRef = useRef(null);
  const pickedRef = useRef(null);
  const focusHelperRef = useRef(null);
  const onStateChangeRef = useRef(onStateChange);
  const assetRef = useRef(asset);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    assetRef.current = asset;
  }, [asset]);

  useImperativeHandle(ref, () => ({
    fitModel: () => fitModel(),
    resetCamera: () => fitModel(),
    locateAsset: (targetAsset) => locateAsset(targetAsset),
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let disposed = false;
    const components = new OBC.Components();
    const worlds = components.get(OBC.Worlds);
    const world = worlds.create();
    world.scene = new OBC.SimpleScene(components);
    world.renderer = new OBC.SimpleRenderer(components, container);
    world.camera = new OBC.SimpleCamera(components);
    components.init();
    world.scene.setup();
    world.scene.three.background = new THREE.Color(0xe8eef1);
    world.camera.controls.setLookAt(30, -30, 24, 0, 0, 0);

    const fragments = components.get(OBC.FragmentsManager);
    componentsRef.current = components;
    fragmentsRef.current = fragments;
    worldRef.current = world;

    async function initFragments() {
      fragments.init("/fragments-worker/worker.mjs");
      world.camera.controls.addEventListener("update", () => fragments.core.update());
      world.camera.controls.addEventListener("rest", () => fragments.core.update(true));
      world.onCameraChanged.add((camera) => {
        for (const [, model] of fragments.list) model.useCamera(camera.three);
        fragments.core.update(true);
      });
      fragments.list.onItemSet.add(({ value: model }) => {
        model.useCamera(world.camera.three);
        world.scene.three.add(model.object);
        fragments.core.update(true);
      });
    }

    fragmentsReadyRef.current = initFragments();
    fragmentsReadyRef.current.catch((error) => {
      if (!disposed) {
        onStateChangeRef.current({ status: "Error", message: error.message, progress: 0 });
      }
    });

    return () => {
      disposed = true;
      clearFocusMode();
      components.dispose();
      componentsRef.current = null;
      fragmentsRef.current = null;
      fragmentsReadyRef.current = null;
      modelRef.current = null;
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!modelFile || !componentsRef.current || !worldRef.current || !fragmentsRef.current) return undefined;
    let cancelled = false;

    async function loadIfc() {
      try {
        onStateChangeRef.current({ status: "Loading", message: "Loading IFC model", progress: 0 });
        const components = componentsRef.current;
        const fragments = fragmentsRef.current;
        await fragmentsReadyRef.current;

        clearFocusMode();
        for (const [, model] of fragments.list) {
          await model.dispose();
        }
        modelRef.current = null;
        pickedRef.current = null;

        const loader = components.get(OBC.IfcLoader);
        await loader.setup({
          autoSetWasm: false,
          wasm: { path: "/wasm/", absolute: true },
        });

        const response = await fetch(`/bim-output/${encodeURIComponent(modelFile.name)}`);
        if (!response.ok) throw new Error(`IFC file not found: ${modelFile.name}`);
        const buffer = await response.arrayBuffer();
        const model = await loader.load(new Uint8Array(buffer), true, modelFile.name, {
          instanceCallback: (importer) => {
            importer.addAllAttributes();
            importer.addAllRelations();
          },
        });
        if (cancelled) {
          await model.dispose();
          return;
        }

        model.object.traverse((child) => {
          if (!child.material) return;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => {
            material.side = THREE.DoubleSide;
            material.needsUpdate = true;
          });
        });

        modelRef.current = model;
        await fitModel();
        fragments.core.update(true);
        onStateChangeRef.current({ status: "Ready", message: `Loaded ${modelFile.name}`, progress: 100 });
        if (assetRef.current?.ifcGuid) await locateAsset(assetRef.current);
      } catch (error) {
        onStateChangeRef.current({ status: "Error", message: error.message || "IFC load failed", progress: 0 });
      }
    }

    const id = window.setTimeout(loadIfc, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [modelFile?.name]);

  useEffect(() => {
    if (asset?.ifcGuid && modelRef.current) {
      locateAsset(asset);
    }
  }, [asset?.id, asset?.ifcGuid]);

  async function markPicked(model, localId) {
    try {
      if (pickedRef.current?.model && pickedRef.current.localId !== localId) {
        await pickedRef.current.model.resetColor([pickedRef.current.localId]);
      }
      await model.setColor([localId], PICKED_COLOR);
      pickedRef.current = { model, localId };
      fragmentsRef.current?.core.update(true);
    } catch {
      // Highlighting is visual only; focusing can still proceed.
    }
  }

  function clearFocusMode() {
    const world = worldRef.current;
    const helper = focusHelperRef.current;
    if (helper && world?.scene) {
      world.scene.three.remove(helper);
      helper.traverse((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
        else child.material?.dispose?.();
      });
    }
    focusHelperRef.current = null;
    fragmentsRef.current?.core.update(true);
  }

  function applyFocusMode(box) {
    const world = worldRef.current;
    if (!world?.scene) return;
    clearFocusMode();

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const helperGroup = new THREE.Group();
    helperGroup.name = "Selected asset focus";

    const itemBox = box.clone().expandByScalar(0.18);
    const boxHelper = new THREE.Box3Helper(itemBox, 0xf59e0b);
    if (boxHelper.material) {
      boxHelper.material.depthTest = false;
      boxHelper.material.transparent = true;
      boxHelper.material.opacity = 0.95;
    }
    boxHelper.renderOrder = 999;
    helperGroup.add(boxHelper);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(size.length() * 0.75, 0.45), 32, 16),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
        depthWrite: false,
      }),
    );
    halo.position.copy(center);
    halo.renderOrder = 1000;
    helperGroup.add(halo);

    focusHelperRef.current = helperGroup;
    world.scene.three.add(helperGroup);
    fragmentsRef.current?.core.update(true);
  }

  async function zoomToLocalId(localId) {
    const model = modelRef.current;
    const world = worldRef.current;
    if (!model || !world?.camera) return;
    const boxes = await model.getBoxes([localId]);
    if (!boxes?.length) return;
    const box = boxes.reduce((acc, item) => acc.union(item), boxes[0].clone());
    applyFocusMode(box);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 2.4, 2.8);
    const camera = world.camera.three;
    camera.near = 0.01;
    camera.far = Math.max(radius * 300, 1000);
    camera.updateProjectionMatrix();
    await world.camera.controls.setLookAt(
      center.x + radius * 1.15,
      center.y + radius * 0.85,
      center.z + radius * 1.05,
      center.x,
      center.y,
      center.z,
      true,
    );
    fragmentsRef.current?.core.update(true);
  }

  async function locateAsset(targetAsset) {
    const model = modelRef.current;
    if (!model || !targetAsset?.ifcGuid) return;
    try {
      const [localId] = await model.getLocalIdsByGuids([targetAsset.ifcGuid]);
      if (!localId) {
        onStateChangeRef.current({
          status: "Ready",
          message: `No IFC object for ${targetAsset.assetCode}`,
          progress: 100,
        });
        return;
      }
      await markPicked(model, localId);
      await zoomToLocalId(localId);
      onStateChangeRef.current({ status: "Ready", message: `Focused ${targetAsset.assetCode}`, progress: 100 });
    } catch (error) {
      onStateChangeRef.current({ status: "Error", message: error.message || "Locate failed", progress: 0 });
    }
  }

  async function fitModel() {
    const world = worldRef.current;
    const model = modelRef.current;
    if (!world?.camera || !model?.box) return;
    clearFocusMode();
    const box = model.box;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z, 10);
    const distance = Math.max(maxSize * 0.95, 12);
    const camera = world.camera.three;
    camera.near = 0.01;
    camera.far = Math.max(maxSize * 120, 1000);
    camera.updateProjectionMatrix();
    await world.camera.controls.setLookAt(
      center.x + distance * 0.8,
      center.y - distance * 0.75,
      center.z + distance * 0.55,
      center.x,
      center.y,
      center.z,
      false,
    );
    await world.camera.controls.fitToSphere(new THREE.Sphere(center, Math.max(maxSize * 0.55, 7)), true);
    fragmentsRef.current?.core.update(true);
  }

  return <div className="integration-ifc-canvas" ref={containerRef} />;
});
