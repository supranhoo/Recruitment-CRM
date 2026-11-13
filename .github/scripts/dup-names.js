// Apps Script puts every .gs file in ONE global scope: two files declaring the same top-level function or const silently
// override each other (the later file in load order wins). Fails when a name is declared twice with DIFFERENT bodies.
// Identical copies are tolerated. Usage: node .github/scripts/dup-names.js [dir]
const fs = require('fs'), path = require('path');
function scan(dir) {
  const seen = {};
  fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort().forEach(f => {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
    const decl = /^(?:async\s+)?(?:function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(decl); if (!m) continue;
      const name = m[1] || m[2]; let j = i + 1;
      while (j < lines.length && !decl.test(lines[j]) && !/^(\/\*\*|\/\/)/.test(lines[j])) j++;
      const body = lines.slice(i, j).join('\n').replace(/\s+/g, ' ').trim();
      (seen[name] = seen[name] || []).push({ file: f, line: i + 1, body });
    }
  });
  const bad = [];
  Object.keys(seen).forEach(n => {
    const d = seen[n]; if (d.length < 2) return;
    if (d.some(x => x.body !== d[0].body)) bad.push(n + ': ' + d.map(x => x.file + ':' + x.line).join(', '));
  });
  return bad;
}
if (require.main === module) {
  const bad = scan(process.argv[2] || '.');
  if (bad.length) { console.error('Duplicate top-level names with different bodies (the later file silently wins):\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log('No conflicting duplicate names.');
}
module.exports = { scan };
