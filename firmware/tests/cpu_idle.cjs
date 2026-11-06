// Measures how much CPU the worker uses during a sleeping loop and at the idle REPL.
const { Board } = require('../host/board.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function measure(name, code, prep) {
  const board = new Board({ files: { '/code.py': code } });
  await board.waitForOutput('code.py output:');
  if (prep) await prep(board);
  await sleep(300);
  const before = process.cpuUsage();
  await sleep(2000);
  const used = process.cpuUsage(before);
  console.log(name, `${(((used.user + used.system) / 2e6) * 100).toFixed(1)}% of one core`);
  await board.stop();
}
(async () => {
  await measure('sleep(0.5) loop:', 'import time\nwhile True:\n    time.sleep(0.5)\n');
  await measure('blink sleep(0.1):', 'import time\nwhile True:\n    time.sleep(0.1)\n');
  await measure('idle REPL:', 'print("x")\n', async (b) => { await b.waitForOutput('Press any key'); b.write('\r'); await b.waitForOutput('>>> '); });
  await measure('busy loop:', 'while True:\n    pass\n');
  process.exit(0);
})();
