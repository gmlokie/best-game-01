// NEON RUSH — keyboard + mouse input.
// One shared input state: the race module reads it every fixed step, the
// menus read edge-triggered presses. Keys are tracked by code (not key) so
// layouts do not matter. Nothing here depends on timing — a press is a press
// until the game consumes it.

export function makeInput() {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    drift: false,
    boost: false,
    pressed: new Set(), // keys pressed since the last consume
    mouseX: 0,
    mouseY: 0,
    mouseClicked: false,
    anyKey: false,
  };
}

const KEY_MAP = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ShiftLeft: 'drift',
  ShiftRight: 'drift',
  Space: 'boost',
};

export function attachInput(input, element) {
  window.addEventListener('keydown', (event) => {
    const field = KEY_MAP[event.code];
    if (field) {
      input[field] = true;
      event.preventDefault();
    }
    if (!event.repeat) {
      input.pressed.add(event.code);
      input.anyKey = true;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    const field = KEY_MAP[event.code];
    if (field) input[field] = false;
  });
  window.addEventListener('blur', () => {
    input.up = false;
    input.down = false;
    input.left = false;
    input.right = false;
    input.drift = false;
    input.boost = false;
  });
  element.addEventListener('mousemove', (event) => {
    const rect = element.getBoundingClientRect();
    input.mouseX = event.clientX - rect.left;
    input.mouseY = event.clientY - rect.top;
  });
  element.addEventListener('mousedown', (event) => {
    const rect = element.getBoundingClientRect();
    input.mouseX = event.clientX - rect.left;
    input.mouseY = event.clientY - rect.top;
    input.mouseClicked = true;
    input.anyKey = true;
  });
}

// Driving input for one fixed step: throttle -1..1, steer -1..1.
export function drivingInput(input) {
  const throttle = (input.up ? 1 : 0) + (input.down ? -1 : 0);
  const steer = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  return { throttle, steer, drift: input.drift, boost: input.boost };
}

// True once if the key was pressed since the last call, then consumed.
export function wasPressed(input, code) {
  if (input.pressed.has(code)) {
    input.pressed.delete(code);
    return true;
  }
  return false;
}

// True once if any key was pressed or the mouse clicked since last call.
export function wasAnyKey(input) {
  if (input.anyKey || input.mouseClicked) {
    input.anyKey = false;
    input.mouseClicked = false;
    input.pressed.clear();
    return true;
  }
  return false;
}

export function clearPresses(input) {
  input.pressed.clear();
  input.anyKey = false;
  input.mouseClicked = false;
}
