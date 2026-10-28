// Run inside the production image with --network none --pids-limit 128.
// Uses real LibreOffice and /proc to catch PID growth across repeated conversions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.LOG_LEVEL = 'error';
process.env.ENABLE_TELEMETRY = 'false';
const { convertDocxToPdf } = require(path.resolve('dist/convert/soffice'));
const input = Buffer.from(fs.readFileSync(path.join(__dirname, 'input.docx.base64'), 'utf8'), 'base64');
const conversions = Number(process.env.DOCGEN_SOAK_CONVERSIONS || 100);
assert(Number.isSafeInteger(conversions) && conversions >= 20, 'Use at least 20 conversions');

function snapshot() {
  let processes = 0;
  let zombies = 0;
  const names = {};
  for (const pid of fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    let status;
    try { status = fs.readFileSync(`/proc/${pid}/status`, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    processes++;
    if (/^State:\s+Z/m.test(status)) zombies++;
    const name = /^Name:\s+(\S+)/m.exec(status)?.[1] || 'unknown';
    names[name] = (names[name] || 0) + 1;
  }
  return { processes, zombies, names };
}

async function convert(index) {
  const pdf = await convertDocxToPdf(input, { correlationId: `lifecycle-soak-${index}` });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'LibreOffice must produce a PDF');
}

(async () => {
  for (let i = 0; i < 3; i++) await convert(`warmup-${i}`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const baseline = snapshot();
  assert.equal(baseline.zombies, 0, `Warmup leaked zombies: ${JSON.stringify(baseline)}`);
  for (let i = 1; i <= conversions; i++) {
    await convert(i);
    if (i % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const current = snapshot();
      assert.equal(current.zombies, 0, `Zombie leak after ${i}: ${JSON.stringify(current)}`);
      assert(current.processes <= baseline.processes + 4,
        `Process count grew after ${i}: ${JSON.stringify({ baseline, current })}`);
      console.log(JSON.stringify({ completed: i, ...current }));
    }
  }
  console.log(JSON.stringify({ result: 'passed', conversions, baseline, final: snapshot() }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
