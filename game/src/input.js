// input.js — keyboard, mouse and pointer lock, kept apart from the game
// logic. The simulation reads this state; it never touches the DOM itself.
// Mouse deltas accumulate between frames and are consumed once per step.

export function createInput(canvas) {
  const input = {
    keys: new Set(),
    pressed: new Set(), // edge-triggered keys, cleared by endFrame()
    mouseDX: 0,
    mouseDY: 0,
    firing: false,
    mousePressed: false, // left-button edge, cleared by endFrame()
    aiming: false, // right mouse button held (scope)
    wheel: 0,
    locked: false,
    // Shot mode (screenshots / tests) never takes pointer lock.
    noLock: false,
  };

  function onKeyDown(e) {
    if (e.repeat) return;
    input.keys.add(e.code);
    input.pressed.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  }
  function onKeyUp(e) {
    input.keys.delete(e.code);
  }
  function onMouseMove(e) {
    if (!input.locked && !input.noLock) return;
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  }
  function onMouseDown(e) {
    if (e.button === 0) {
      input.firing = true;
      input.mousePressed = true;
    }
    if (e.button === 2) input.aiming = true;
  }
  function onMouseUp(e) {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  }
  function onWheel(e) {
    input.wheel += e.deltaY > 0 ? 1 : -1;
  }
  function onLockChange() {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) input.firing = false;
  }
  function onBlur() {
    input.keys.clear();
    input.firing = false;
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('wheel', onWheel);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', onBlur);

  input.requestLock = () => {
    if (input.noLock) return;
    try {
      canvas.requestPointerLock();
    } catch {
      // Pointer lock is a nicety; the game still runs without it.
    }
  };
  input.exitLock = () => {
    if (document.pointerLockElement) document.exitPointerLock();
  };
  input.consumeLook = () => {
    const dx = input.mouseDX;
    const dy = input.mouseDY;
    input.mouseDX = 0;
    input.mouseDY = 0;
    return { dx, dy };
  };
  input.consumeWheel = () => {
    const w = input.wheel;
    input.wheel = 0;
    return w;
  };
  input.down = (code) => input.keys.has(code);
  input.wasPressed = (code) => input.pressed.has(code);
  input.endFrame = () => {
    input.pressed.clear();
    input.mousePressed = false;
  };

  return input;
}
