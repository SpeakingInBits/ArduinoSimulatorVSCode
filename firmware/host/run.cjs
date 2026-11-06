// Runs one Python file on the simulated board and prints the serial console.
// Usage: node run.cjs <code.py> [seconds]
const fs = require('node:fs');
const { Board } = require('./board.cjs');

const [file, seconds = '5'] = process.argv.slice(2);
const board = new Board({ files: { '/code.py': fs.readFileSync(file) } });
board.on('serial', (text) => process.stdout.write(text));
board.on('log', ({ text }) => console.error('[log]', text));
board.on('crash', (message) => {
  console.error('[crash]', message);
  process.exit(1);
});
setTimeout(async () => {
  await board.stop();
  process.exit(0);
}, Number(seconds) * 1000);
