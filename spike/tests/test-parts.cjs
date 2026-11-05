// Builds the parts for a test run. Runs inside the engine worker.
const { parentPort } = require('node:worker_threads');
const { CharacterLcd, Servo, Mcp9808 } = require('../host/parts.cjs');

module.exports = (config = {}) => {
  const parts = [];
  if (config.lcd) {
    const lcd = new CharacterLcd(config.lcd);
    const onPinWrite = lcd.onPinWrite.bind(lcd);
    let last = '';
    lcd.onPinWrite = (pin, value) => {
      onPinWrite(pin, value);
      const lines = lcd.lines();
      if (lines.join() !== last) {
        last = lines.join();
        parentPort.postMessage({ type: 'lcd', lines });
      }
    };
    parts.push(lcd);
  }
  if (config.servo !== undefined) {
    parts.push(new Servo({
      pin: config.servo,
      onAngle: (angle) => parentPort.postMessage({ type: 'angle', angle }),
    }));
  }
  if (config.mcp9808) parts.push(new Mcp9808({}));
  return parts;
};
